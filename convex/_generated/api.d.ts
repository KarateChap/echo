/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chatAgent from "../chatAgent.js";
import type * as claims from "../claims.js";
import type * as crons from "../crons.js";
import type * as customTokens from "../customTokens.js";
import type * as delayExtractor from "../delayExtractor.js";
import type * as executePayment from "../executePayment.js";
import type * as fiatConversion from "../fiatConversion.js";
import type * as http from "../http.js";
import type * as notify from "../notify.js";
import type * as parseIntent from "../parseIntent.js";
import type * as recipients from "../recipients.js";
import type * as rules from "../rules.js";
import type * as scheduler from "../scheduler.js";
import type * as serverTime from "../serverTime.js";
import type * as synthesize from "../synthesize.js";
import type * as tokenExtractor from "../tokenExtractor.js";
import type * as transactions from "../transactions.js";
import type * as transcribe from "../transcribe.js";
import type * as users from "../users.js";
import type * as voiceMessages from "../voiceMessages.js";
import type * as voiceSessions from "../voiceSessions.js";
import type * as withdrawals from "../withdrawals.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chatAgent: typeof chatAgent;
  claims: typeof claims;
  crons: typeof crons;
  customTokens: typeof customTokens;
  delayExtractor: typeof delayExtractor;
  executePayment: typeof executePayment;
  fiatConversion: typeof fiatConversion;
  http: typeof http;
  notify: typeof notify;
  parseIntent: typeof parseIntent;
  recipients: typeof recipients;
  rules: typeof rules;
  scheduler: typeof scheduler;
  serverTime: typeof serverTime;
  synthesize: typeof synthesize;
  tokenExtractor: typeof tokenExtractor;
  transactions: typeof transactions;
  transcribe: typeof transcribe;
  users: typeof users;
  voiceMessages: typeof voiceMessages;
  voiceSessions: typeof voiceSessions;
  withdrawals: typeof withdrawals;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
