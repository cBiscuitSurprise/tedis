import { Http2ServerResponse } from "http2";
import { createConnection, Socket } from "net";
import { connect, TLSSocket } from "tls";
import { v4 as uuidv4 } from "uuid";
// core
import { Protocol } from "./protocol";

type callback = (err: boolean, res: any) => void;

export interface InterfaceBase {
  id: string;
  command(...parameters: Array<string | number>): Promise<any>;
  close(): void;
  on(event: "connect" | "timeout", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (had_error: boolean) => void): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

export interface InterfaceAuth {
  username?: string;
  password?: string;
}

export class Base implements InterfaceBase {
  public id: string;
  private socket: Socket | TLSSocket;
  private protocol: Protocol;
  private callbacks: callback[];
  private handle_connect?: () => void;
  private handle_timeout?: () => void;
  private handle_error?: (err: Error) => void;
  private handle_close?: (had_error: boolean) => void;
  constructor(
    options: {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
      tls?: {
        key: Buffer;
        cert: Buffer;
      };
    } = {}
  ) {
    this.id = uuidv4();
    if (typeof options.tls !== "undefined") {
      this.socket = connect({
        host: options.host || "127.0.0.1",
        port: options.port || 6379,
        key: options.tls.key,
        cert: options.tls.cert,
      });
    } else {
      this.socket = createConnection({
        host: options.host || "127.0.0.1",
        port: options.port || 6379,
      });
    }
    this.protocol = new Protocol();
    this.callbacks = [];
    this.init();

    if ("number" === typeof options.timeout) {
      this.socket.setTimeout(options.timeout);
    }

    if ("string" === typeof options.username) {
      this.auth({
        username: options.username,
        password: options.password,
      });
    } else if ("string" === typeof options.password) {
      this.auth({
        password: options.password,
      });
    }
  }
  public command(...parameters: Array<string | number>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.callbacks.push((err, res) => {
        err ? reject(res) : resolve(res);
      });
      this.socket.write(this.protocol.encode(...parameters));
    });
  }
  public close() {
    this.socket.end();
  }
  public on(event: "connect" | "timeout", listener: () => void): void;
  public on(event: "close", listener: (had_error: boolean) => void): void;
  public on(event: "error", listener: (err: Error) => void): void;
  public on(event: string, listener: (...args: any[]) => void): void {
    switch (event) {
      case "connect":
        this.handle_connect = listener;
        break;
      case "timeout":
        this.handle_timeout = listener;
        break;
      case "error":
        this.handle_error = listener;
        break;
      case "close":
        this.handle_close = listener;
        break;
      default:
        throw new Error("event not found");
    }
  }
  private async auth(options: InterfaceAuth): Promise<any> {
    try {
      let authResponse;
      if (typeof options.username === "string" && typeof options.password === "string") {
        // user with password
        authResponse = await this.command("AUTH", options.username, options.password);
      } else if (typeof options.username === "string") {
        // user with nopass
        authResponse = await this.command("AUTH", options.username);
      } else if (typeof options.password === "string") {
        // default user with password
        authResponse = await this.command("AUTH", options.password);
      } else {
        authResponse = new Error(`Invalid AUTH options: ${JSON.stringify(options)}`);
      }

      if (authResponse instanceof Error) { throw authResponse; }
      return authResponse;
    } catch (error) {
      this.socket.emit("error", error);
      this.socket.end();
    }
  }
  private init() {
    this.socket.on("connect", () => {
      if ("function" === typeof this.handle_connect) {
        this.handle_connect();
      }
    });
    this.socket.on("timeout", () => {
      if ("function" === typeof this.handle_timeout) {
        this.handle_timeout();
      } else {
        this.close();
      }
    });
    this.socket.on("error", (err) => {
      if ("function" === typeof this.handle_error) {
        this.handle_error(err);
      } else {
        console.log("error:", err);
      }
    });
    this.socket.on("close", (had_error: boolean) => {
      if ("function" === typeof this.handle_close) {
        this.handle_close(had_error);
      }
    });
    this.socket.on("data", (data) => {
      this.protocol.write(data);
      const parsed = this.protocol.parse();
      parsed.forEach((message: string) => {
        (this.callbacks.shift() as callback)(
          false,
          message
        );
      });
    });
  }
}
