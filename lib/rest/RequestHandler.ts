import SequentialBucket from "./SequentialBucket";
import DiscordRESTError from "./DiscordRESTError";
import DiscordHTTPError from "./DiscordHTTPError";
import type RESTManager from "./RESTManager";
import type { RESTMethod } from "../Constants";
import { API_URL, RESTMethods, USER_AGENT } from "../Constants";
import TypedEmitter from "../util/TypedEmitter";
import Base from "../structures/Base";
import Properties from "../util/Properties";
import type { RESTOptions } from "../Client";
import { FormData, fetch, File as UFile } from "undici";

/**
 * Latency & ratelimit related things lovingly borrowed from eris
 * https://github.com/abalabahaha/eris/blob/dev/lib/rest/RequestHandler.js
 */

export default class RequestHandler extends TypedEmitter<RequestEvents> {
	private _manager: RESTManager;
	globalBlock = false;
	latencyRef: LatencyRef;
	options: InstanceOptions;
	ratelimits: Record<string, SequentialBucket> = {};
	readyQueue: Array<() => void> = [];
	/**
	 * Construct an instance of RequestHandler
	 *
	 * @param {RESTOptions} options - the options for the request handler
	 */
	constructor(manager: RESTManager, options: RESTOptions = {}) {
		super();
		if (options && options.baseURL && options.baseURL.endsWith("/")) options.baseURL = options.baseURL.slice(0, -1);
		Properties.new(this)
			.define("_manager", manager)
			.define("options", {
				agent:                      options.agent,
				baseURL:                    options.baseURL || API_URL,
				disableLatencyCompensation: !!options.disableLatencyCompensation,
				host:                       options.host || options.baseURL ? new URL(this.options.baseURL).host : new URL(API_URL).host,
				latencyThreshold:           options.latencyThreshold ?? 30000,
				ratelimiterOffset:          options.ratelimiterOffset ?? 0,
				requestTimeout:             options.requestTimeout ?? 15000,
				userAgent:                  options.userAgent || USER_AGENT
			})
			.define("latencyRef", {

				lastTimeOffsetCheck: 0,
				latency:             options.ratelimiterOffset,
				raw:                 new Array(10).fill(options.ratelimiterOffset),
				timeOffsets:         new Array(10).fill(0),
				timeoffset:          0
			});

	}

	private getRoute(path: string, method: string) {
		let route = path.replace(/\/([a-z-]+)\/(?:[\d]{15,21})/g, function(match, p) {
			return p === "channels" || p === "guilds" || p === "webhooks" ? match : `/${p as string}/:id`;
		}).replace(/\/reactions\/[^/]+/g, "/reactions/:id").replace(/\/reactions\/:id\/[^/]+/g, "/reactions/:id/:userID").replace(/^\/webhooks\/(\d+)\/[A-Za-z0-9-_]{64,}/, "/webhooks/$1/:token");
		if (method === "DELETE" && route.endsWith("/messages/:id")) {
			const messageID = path.slice(path.lastIndexOf("/") + 1);
			const createdAt = Base.getCreatedAt(messageID);
			if (Date.now() - this.latencyRef.latency - createdAt >= 1000 * 60 * 60 * 24 * 14) method += "_OLD";
			else if (Date.now() - this.latencyRef.latency - createdAt <= 1000 * 10) method += "_NEW";
			route = method + route;
		} else if (method === "GET" && /\/guilds\/[0-9]+\/channels$/.test(route)) {
			route = "/guilds/:id/channels";
		}
		if (method === "PUT" || method === "DELETE") {
			const index = route.indexOf("/reactions");
			if (index !== -1) route = "MODIFY" + route.slice(0, index + 10);
		}
		return route;
	}

	private globalUnblock() {
		this.globalBlock = false;
		while (this.readyQueue.length > 0) this.readyQueue.shift()!();
	}

	/** same as `request`, but with `auth` always set to `true`. */
	async authRequest<T = unknown>(options: Omit<RequestOptions, "auth">) {
		return this.request<T>({
			...options,
			auth: true
		});
	}

	/**
	 * Make a request
	 *
	 * @template T
	 * @param {Object} options
	 * @param {(Boolean | String)} [options.auth=false] - True to use global auth if specified, false for no auth, and a string value for specific authorization (must be prefixed).
	 * @param {File[]} [options.files] - The files to send with this request.
	 * @param {FormData} [options.form] - The form body to send with the request. Mutually exclusive with `json`.
	 * @param {Object} [options.json] - The json body to send with the request. Mutually exclusive with `form`.
	 * @param {RESTMethod} options.method - The method of this request.
	 * @param {String} options.path - The path of this request - will be combined with baseURL.
	 * @param {Boolean} [options.priority=false] - If this request should be considered a priority.
	 * @param {String} [options.reason] - The value to pass in `X-Audit-Log-Reason`, if applicable.
	 * @param {String} [options.route] - The route path (with placeholders).
	 * @returns {Promise<T>} - The result body, null if no content
	 */
	async request<T = unknown>(options: RequestOptions) {
		options.method = options.method.toUpperCase() as RESTMethod;
		if (!RESTMethods.includes(options.method)) throw new Error(`Invalid method "${options.method}.`);
		const _stackHolder = {};
		Error.captureStackTrace(_stackHolder);
		if (!options.path.startsWith("/")) options.path = `/${options.path}`;
		const route = options.route || this.getRoute(options.path, options.method);
		if (!this.ratelimits[route]) this.ratelimits[route] = new SequentialBucket(1, this.latencyRef);
		let attempts = 0;
		return new Promise<T>((resolve, reject) => {
			async function attempt(this: RequestHandler, cb: () => void) {
				const headers: Record<string, string> = {};
				try {
					if (typeof options.auth === "string") headers.Authorization = options.auth;
					else if (options.auth && this._manager.client.options.auth) headers.Authorization = this._manager.client.options.auth;
					if (options.reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(options.reason);

					let reqBody: string | FormData | undefined;
					if (options.method !== "GET") {
						let stringBody: string | undefined;
						if (options.json) stringBody = JSON.stringify(options.json, (k, v: unknown) => typeof v === "bigint" ? v.toString() : v);
						if (options.form) reqBody = options.form;
						if (options.files && options.files.length > 0) {
							const data = reqBody && reqBody instanceof FormData ? reqBody : new FormData();
							options.files.forEach((file, index) => {
								if (!file.contents) return;
								data.set(`files[${index}]`, new UFile([file.contents], file.name));
							});
							if (stringBody) data.set("payload_json", stringBody);
							reqBody = data;
						} else if (options.json) {
							reqBody = stringBody;
							headers["Content-Type"] = "application/json";
						}
					}

					if (this.options.host) headers.Host = this.options.host;
					const url = `${this.options.baseURL}${options.path}`;
					let latency = Date.now();
					const controller = new AbortController();
					let timeout: NodeJS.Timeout | undefined;
					if (this.options.requestTimeout > 0 && this.options.requestTimeout !== Infinity) timeout = setTimeout(() => controller.abort(), this.options.requestTimeout);
					const res = await fetch(url, {
						method:     options.method,
						headers,
						body:       reqBody,
						dispatcher: this.options.agent || undefined,
						signal:     controller.signal
					});
					if (timeout) clearTimeout(timeout);
					latency = Date.now() - latency;
					if (!this.options.disableLatencyCompensation) {
						this.latencyRef.raw.push(latency);
						this.latencyRef.latency = this.latencyRef.latency - ~~(this.latencyRef.raw.shift()! / 10) + ~~(latency / 10);
					}
					let resBody: string | Record<string, unknown> | null;
					if (res.status === 204) resBody = null;
					else {
						const b = await res.text();
						if (res.headers.get("content-type") === "application/json") {
							try {
								resBody = JSON.parse(b) as Record<string, unknown>;
							} catch (err) {
								this.emit("error", err as Error);
								resBody = b;
							}
						} else resBody = b;
					}
					if (this.listeners("request").length) {
						this.emit("request", {
							method:       options.method,
							path:         options.path,
							route,
							withAuth:     !!options.auth,
							requestBody:  reqBody,
							responseBody: resBody
						});
					}
					const headerNow = Date.parse(res.headers.get("date")!);
					const now = Date.now();
					if (this.latencyRef.lastTimeOffsetCheck < (Date.now() - 5000)) {
						const timeOffset = headerNow + 500 - (this.latencyRef.lastTimeOffsetCheck = Date.now());
						if (this.latencyRef.timeoffset - this.latencyRef.latency >= this.options.latencyThreshold && timeOffset - this.latencyRef.latency >= this.options.latencyThreshold) {
							this.emit("warn", `Your clock is ${this.latencyRef.timeoffset}ms behind Discord's server clock. Please check your connection and system time.`);
						}
						this.latencyRef.timeoffset = this.latencyRef.timeoffset - ~~(this.latencyRef.timeOffsets.shift()! / 10) + ~~(timeOffset / 10);
						this.latencyRef.timeOffsets.push(timeOffset);
					}
					if (res.headers.has("x-ratelimit-limit")) this.ratelimits[route].limit = Number(res.headers.get("x-ratelimit-limit"));
					if (options.method !== "GET" && (!res.headers.has("x-ratelimit-remaining") || !res.headers.has("x-ratelimit-limit")) && this.ratelimits[route].limit !== 1) {
						this.emit("debug", [`Missing ratelimit headers for SequentialBucket(${this.ratelimits[route].remaining}/${this.ratelimits[route].limit}) with non-default limit\n`,
							`${res.status} ${res.headers.get("content-type")!}: ${options.method} ${route} | ${res.headers.get("cf-ray")!}\n`,
							`content-type = ${res.headers.get("content-type")!}\n`,
							`x-ratelimit-remaining = " + ${res.headers.get("x-ratelimit-remaining")!}\n`,
							`x-ratelimit-limit = " + ${res.headers.get("x-ratelimit-limit")!}\n`,
							`x-ratelimit-reset = " + ${res.headers.get("x-ratelimit-reset")!}\n`,
							`x-ratelimit-global = " + ${res.headers.get("x-ratelimit-global")!}`].join("\n"));
					}
					this.ratelimits[route].remaining = !res.headers.has("x-ratelimit-remaining") ? 1 : Number(res.headers.get("x-ratelimit-remaining")) || 0;
					const retryAfter = Number(res.headers.get("x-ratelimit-reset-after") || res.headers.get("retry-after") || 0);
					if (retryAfter >= 0) {
						if (res.headers.has("x-ratelimit-global")) {
							this.globalBlock = true;
							setTimeout(this.globalUnblock.bind(this), retryAfter || 1);
						} else this.ratelimits[route].reset = (retryAfter || 1) + now;
					} else if (res.headers.has("x-ratelimit-reset")) {
						let resetTime = Number(res.headers.get("x-ratelimit-reset")) * 100;
						if (route.endsWith("/reactions/:id") && (resetTime - headerNow) === 1000) resetTime = now + 250;
						this.ratelimits[route].reset = Math.max(resetTime - this.latencyRef.latency, now);
					} else this.ratelimits[route].reset = now;
					if (res.status !== 429 && this.listeners("debug").length) this.emit("debug", `${now} ${route} ${res.status}: ${latency}ms (${this.latencyRef.latency}ms avg) | ${this.ratelimits[route].remaining}/${this.ratelimits[route].limit} left | Reset ${this.ratelimits[route].reset} (${this.ratelimits[route].reset - now}ms left)`);
					if (res.status > 300) {
						if (res.status === 429) {
							let delay = retryAfter;
							if (res.headers.get("x-ratelimit-scope") === "shared") {
								try {
									delay = (resBody as { retry_after: number; }).retry_after;
								} catch (err) {
									reject(err);
								}
							}
							this.emit("debug", `${res.headers.has("x-ratelimit-global") ? "Global" : "Unexpected"} RateLimit: ${JSON.stringify(resBody)}\n${now} ${route} ${res.status}: ${latency}ms (${this.latencyRef.latency}ms avg) | ${this.ratelimits[route].remaining}/${this.ratelimits[route].limit} left | Reset ${delay} (${this.ratelimits[route].reset - now}ms left) | Scope ${res.headers.get("x-ratelimit-scope")!}`);
							if (delay) {
								setTimeout(() => {
									cb();
									// eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, prefer-spread
									this.request<T>(options).then(resolve).catch(reject);
								}, delay);
							} else {
								cb();
								this.request<T>(options).then(resolve).catch(reject);
							}
						} else if (res.status === 502 && ++attempts < 4) {
							this.emit("debug", `Unexpected 502 on ${options.method} ${route}`);
							setTimeout(() => {
								this.request<T>(options).then(resolve).catch(reject);
							}, Math.floor(Math.random() * 1900 + 100));
							return cb();
						}
						cb();
						let { stack } = _stackHolder as { stack: string; };
						if (stack.startsWith("Error\n")) stack = stack.substring(6);
						let err;
						if (resBody && typeof resBody === "object" && "code" in resBody) {
							err = new DiscordRESTError(res, resBody, options.method, stack);
						} else {
							err = new DiscordHTTPError(res, resBody, options.method, stack);
						}
						reject(err);
						return;
					}

					cb();
					resolve(resBody as T);
				} catch (err) {
					if (err instanceof Error && err.constructor.name === "DOMException" && err.name === "AbortError") {
						cb();
						reject(new Error(`Request Timed Out (>${this.options.requestTimeout}ms) on ${options.method} ${options.path}`));
					}
					this.emit("error", err as Error);
				}
			}
			if (this.globalBlock && options.auth) {
				(options.priority ? this.readyQueue.unshift.bind(this.readyQueue) : this.readyQueue.push.bind(this.readyQueue))(() => {
					this.ratelimits[route].queue(attempt.bind(this), options.priority);
				});
			} else this.ratelimits[route].queue(attempt.bind(this), options.priority);
		});
	}
}

// internal use
type InstanceOptions = Required<Omit<RESTOptions, "agent">> & Pick<RESTOptions, "agent">;

export interface RequestOptions {
	auth?: boolean | string;
	files?: Array<File>;
	form?: FormData;
	json?: unknown;
	method: RESTMethod;
	path: string;
	priority?: boolean;
	reason?: string;
	route?: string;
}

export interface File {
	/** the contents of the file */
	contents: Buffer;
	/** the name of the file */
	name: string;
}

export interface RawRequest {
	/** the method of the request */
	method: RESTMethod;
	/** the path of the request */
	path: string;
	/** the body sent with the request */
	requestBody: string | FormData | undefined;
	/** the body we recieved */
	responseBody: string | Record<string, unknown> | null;
	/** the name of the route used in the request */
	route: string;
	/** if the request used authorization */
	withAuth: boolean;
}

export interface RequestEvents {
	debug: [info: string];
	error: [err: Error];
	request: [rawRequest: RawRequest];
	warn: [info: string];
}

export interface LatencyRef {
	lastTimeOffsetCheck: number;
	latency: number;
	raw: Array<number>;
	timeOffsets: Array<number>;
	timeoffset: number;
}
