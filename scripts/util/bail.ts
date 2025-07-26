import console from "node:console";
import process from "node:process";

export const bail = (message: string, exitCode = 1): never => {
	console.error(message);
	process.exit(exitCode);
};
