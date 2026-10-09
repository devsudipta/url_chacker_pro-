import { lookup } from "node:dns";
import { isIP, BlockList } from "node:net";
import type { LookupFunction } from "node:net";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
] as const)
  blocked.addSubnet(ip, bits, "ipv6");
export function privateAddress(address: string): boolean {
  const family = isIP(address);
  if (
    family === 6 &&
    !address.toLowerCase().startsWith("::ffff:") &&
    !/^[23][0-9a-f]{3}:/i.test(address)
  )
    return true;
  return family === 0 || blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}
export function permittedAddress(
  host: string,
  address: string,
  grants: string[],
): boolean {
  // Link-local/metadata, unspecified and multicast are never monitoring targets.
  const hard = new BlockList();
  for (const [ip, bits] of [
    ["0.0.0.0", 8],
    ["169.254.0.0", 16],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const)
    hard.addSubnet(ip, bits, "ipv4");
  hard.addSubnet("fe80::", 10, "ipv6");
  hard.addSubnet("ff00::", 8, "ipv6");
  hard.addAddress("::", "ipv6");
  hard.addSubnet("64:ff9b::", 96, "ipv6");
  hard.addSubnet("2002::", 16, "ipv6");
  hard.addSubnet("2001::", 32, "ipv6");
  hard.addAddress("100.100.100.200", "ipv4");
  hard.addAddress("168.63.129.16", "ipv4");
  hard.addAddress("fd00:ec2::254", "ipv6");
  if (
    hard.check(address, isIP(address) === 6 ? "ipv6" : "ipv4") ||
    address === "100.100.100.200"
  )
    return false;
  return (
    !privateAddress(address) ||
    grants.some(
      (item) =>
        item.toLowerCase().replace(/^\[|\]$/g, "") === host.toLowerCase(),
    )
  );
}
export function safeLookup(grants: string[]): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      if (
        !addresses.length ||
        addresses.some(
          (item) => !permittedAddress(hostname, item.address, grants),
        )
      ) {
        callback(
          Object.assign(
            new Error(
              "Monitoring target is not authorized; grant its exact private hostname explicitly",
            ),
            { code: "TARGET_BLOCKED" },
          ),
          "",
          4,
        );
        return;
      }
      // Pin the resolved address: the HTTP client cannot resolve again after validation.
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
export function validateLiteral(url: URL, grants: string[]): void {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !permittedAddress(host, host, grants))
    throw Object.assign(new Error("Monitoring target is not authorized"), {
      code: "TARGET_BLOCKED",
    });
}
