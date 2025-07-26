import { BlockList } from "node:net";

export const ipSafelist = (allowedIPMasks: string[]): (ip: string) => boolean => {
	const blockList = allowedIPMasks.reduce((list, cidr) => {
		const [ ip, mask ] = cidr.split("/");
		list.addSubnet(ip, Number.parseInt(mask, 10));
		return list;
	}, new BlockList());
	return (ip: string): boolean => {
		return blockList.check(ip);
	};
};
