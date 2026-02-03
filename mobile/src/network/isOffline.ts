export type NetworkStatusLike = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

export function isOffline(status: NetworkStatusLike): boolean {
  return status.isConnected === false || status.isInternetReachable === false;
}

