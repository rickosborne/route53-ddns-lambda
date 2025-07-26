import {describe, test} from "node:test";
import assert from "node:assert/strict";
import { ipSafelist } from "../ip-safelist.js";

describe(ipSafelist.name, () => {
	/** @see https://en.wikipedia.org/wiki/Reserved_IP_addresses */
	const privateRanges = [
		"0.0.0.0/8",
		"10.0.0.0/8",
		"100.64.0.0/10",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"172.16.0.0/12",
		"192.168.0.0/16",
	];

	const examples: [allowed: string[], ip: string, expected: boolean][] = [
		[privateRanges, "127.1.2.3", true],
		[privateRanges, "128.1.2.3", false],
		[privateRanges, "192.168.254.254", true],
		[privateRanges, "192.168.999.999", false],
	];

	for (const [allowed, ip, expected] of examples) {
		test(`${expected ? "allow" : "block"} ${ip}`, () => {
			const safelist = ipSafelist(allowed);
			assert.equal(safelist(ip), expected);
		});
	}
});
