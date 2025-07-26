import * as console from "node:console";
import { buildFunction } from "./util/build-function.js";


buildFunction()
	.then((codeHash) => {
		console.log(`Built code hash: ${ codeHash }`)
	})
	.catch((error: unknown) => {
		console.error({ error });
		process.exit(1);
	});
