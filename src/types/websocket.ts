// Type guard for Pusher connector
export const isPusherConnector = (
  connector: any
): connector is { pusher: any } => {
  return connector && typeof connector.pusher !== "undefined";
};

// Get pusher connection safely
export const getPusherConnection = (echoInstance: any) => {
  if (!echoInstance?.connector || !isPusherConnector(echoInstance.connector)) {
    return null;
  }
  return echoInstance.connector.pusher?.connection;
};

// Get socket ID safely
export const getSocketId = (echoInstance: any): string | null => {
  const connection = getPusherConnection(echoInstance);
  return connection?.socket_id || null;
};

// Connection status type
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
