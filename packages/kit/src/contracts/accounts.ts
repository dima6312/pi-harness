// What the accounts feature knows about the account a provider uses.
import { defineContract } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";

export interface AccountWindow {
	name: string;
	/** Percent used of that window, 0..100. */
	used: number;
	/** Time left in the window, like `11m`. */
	resetsIn?: string;
}

export interface AccountState {
	provider: string;
	label: string;
	windows: AccountWindow[];
	/** The provider refused the account's credential, so it needs a sign-in. */
	needsLogin?: boolean;
}

/** The account in use, keyed by provider. Nobody answers for a provider with no accounts. */
export const ACCOUNT = defineContract<AccountState, string>(
	"accounts:state",
	guarded(isAccountState, "an account with a provider, a label and windows"),
);

function isAccountState(value: unknown): value is AccountState {
	if (!isObject(value) || typeof value.provider !== "string" || typeof value.label !== "string")
		return false;
	return Array.isArray(value.windows) && value.windows.every(isWindow);
}

function isWindow(value: unknown): value is AccountWindow {
	return isObject(value) && typeof value.name === "string" && typeof value.used === "number";
}
