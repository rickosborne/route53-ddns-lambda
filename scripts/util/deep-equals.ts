export const deepEquals = <T>(a: T, b: T): boolean => {
	if (typeof a !== "object" || typeof b !== "object" || a === b) {
		return a === b;
	}
	if ((a == null) !== (b == null)) {
		return false;
	}
	if ((a === null && b === null) || (a === undefined && b === undefined)) {
		return true;
	}
	if (a == null || b == null) {
		return a === b;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((aValue, index) => deepEquals(aValue, b[index]));
	}
	const aKeys = Object.keys(a).sort();
	const bKeys = Object.keys(b).sort();
	if (!deepEquals(aKeys, bKeys)) {
		return false;
	}
	const aRec = a as Record<string | symbol, unknown>;
	const bRec = b as Record<string | symbol, unknown>;
	return aKeys.every((key) => deepEquals(aRec[key], bRec[key]));
};
