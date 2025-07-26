import console from "node:console";
import { bail } from "./bail.js";

export const checkAwsError = (undefIf?: string) => (err: unknown): undefined | never => {
	if (err instanceof Error) {
		if (undefIf === err.name) {
			return undefined;
		}
		if (err.name === "AccessDenied") {
			return bail("❌👮 Access was denied.  Did you set your AWS_PROFILE or login with aws sso?");
		}
	}
	console.error(err);
	return bail("❌ Unknown error");
};
