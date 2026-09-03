import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { JobSourceError } from './job-source.errors';
import type { JobSourceDnsResolver, ResolvedAddress } from './job-source.types';

export const LIVE_JOB_SOURCE_HOSTS = Object.freeze([
  'wanted.co.kr',
  'www.wanted.co.kr',
] as const);

export class SystemJobSourceDnsResolver implements JobSourceDnsResolver {
  async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => {
      if (family !== 4 && family !== 6) {
        throw new JobSourceError('JOB_SOURCE_FETCH_FAILED');
      }
      return { address, family };
    });
  }
}

function ipv4Number(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!) >>> 0;
}

function inIpv4Cidr(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const blocked: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, prefix]) => inIpv4Cidr(value, base, prefix));
}

function ipv6Number(address: string): bigint | null {
  let value = address.toLowerCase().split('%', 1)[0]!;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = ipv4Number(value.slice(lastColon + 1));
    if (lastColon < 0 || ipv4 === null) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv6Cidr(base: string, prefix: number): readonly [bigint, bigint] {
  const value = ipv6Number(base)!;
  const shift = BigInt(128 - prefix);
  return [value >> shift, shift];
}

function inIpv6Cidr(value: bigint, base: string, prefix: number): boolean {
  const [network, shift] = ipv6Cidr(base, prefix);
  return value >> shift === network;
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6Number(address);
  if (value === null) return false;
  if (inIpv6Cidr(value, '::ffff:0:0', 96)) {
    const ipv4 = Number(value & 0xffffffffn);
    const dotted = `${ipv4 >>> 24}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`;
    return isPublicIpv4(dotted);
  }
  if (!inIpv6Cidr(value, '2000::', 3)) return false;
  const blocked: ReadonlyArray<readonly [string, number]> = [
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
  ];
  return !blocked.some(([base, prefix]) => inIpv6Cidr(value, base, prefix));
}

export function isPublicNetworkAddress(address: ResolvedAddress): boolean {
  const family = isIP(address.address);
  if (family !== address.family) return false;
  return family === 4 ? isPublicIpv4(address.address) : isPublicIpv6(address.address);
}

export function validateJobSourceUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  if (!rawUrl || rawUrl.length > 2_048) throw new JobSourceError('JOB_SOURCE_URL_INVALID');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new JobSourceError('JOB_SOURCE_URL_INVALID', { cause: error });
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.hash ||
    (url.port && url.port !== '443')
  ) throw new JobSourceError('JOB_SOURCE_URL_INVALID');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    !allowedHosts.includes(hostname)
  ) throw new JobSourceError('JOB_SOURCE_HOST_UNSUPPORTED');
  url.hostname = hostname;
  return url;
}

export async function resolvePublicAddresses(
  url: URL,
  resolver: JobSourceDnsResolver,
): Promise<readonly ResolvedAddress[]> {
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolver.resolve(url.hostname);
  } catch (error) {
    throw new JobSourceError('JOB_SOURCE_FETCH_FAILED', { cause: error });
  }
  if (!addresses.length || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw new JobSourceError('JOB_SOURCE_ADDRESS_BLOCKED');
  }
  return Object.freeze(addresses.map((address) => Object.freeze({ ...address })));
}
