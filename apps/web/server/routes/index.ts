import { adminRouter } from "./admin";
import { authed } from "./base";
import { readerRouter } from "./reader";

/**
 * The app router — enforced by @feedreader/api contract.
 *
 * `authed.router()` validates at compile-time that every contract route
 * has a matching handler implementation. If the contract adds a route
 * and the server doesn't implement it, TypeScript will error here.
 */
export const router = authed.router({
	reader: readerRouter,
	admin: adminRouter,
});
