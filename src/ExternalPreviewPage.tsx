import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API } from "./utils/api";
import Presenter from "./Presenter";
import {
  Button,
  InlineLoading,
  InlineNotification,
} from "carbon-components-react";
import Echo from "laravel-echo";
import Pusher from "pusher-js";
import {
  FormData,
  ApiDataResponse,
  ApiDataItem,
  URLParams,
} from "./types/form";
import {
  isPusherConnector,
  getSocketId,
  ConnectionStatus,
  getConnectionStatusColor,
} from "./types/websocket";

// Extend Window interface for Pusher
// Required for Laravel Echo to work
declare global {
  interface Window {
    Pusher: typeof Pusher;
    Echo: Echo<any> | undefined;
  }
}

// Ensure Pusher is available globally for Laravel Echo
if (typeof window !== "undefined" && !window.Pusher) {
  window.Pusher = Pusher;
}

// Global state for Echo instance management
let globalEchoInstance: any = null;
let globalInitializing = false;

const transformApiResponse = (apiData: ApiDataResponse): FormData => {
  return {
    form_definition: apiData.form_template,
    logs: apiData.logs,
    data:
      apiData.data?.items?.reduce<Record<string, string>>(
        (acc, item: ApiDataItem) => {
          if (item.id) {
            acc[item.id] = item.value || "";
          }
          return acc;
        },
        {}
      ) || {},
    metadata: {},
  };
};

const setupChannelEventBindings = (channel: any, onUpdate: () => void) => {
  try {
    if (typeof channel.bind === "function") {
      channel.bind("pusher:subscription_error", (error: any) => {
        console.error("Subscription error:", error);
      });

      if (typeof channel.bind_global === "function") {
        channel.bind_global((eventName: string) => {
          if (
            eventName === "App\\Events\\FormVersionUpdateEvent" ||
            eventName === "FormVersionUpdateEvent"
          ) {
            onUpdate();
          }
        });
      }

      channel.bind("App\\Events\\FormVersionUpdateEvent", onUpdate);
    }

    if (typeof channel.listen === "function") {
      channel.listen("FormVersionUpdateEvent", onUpdate);
      channel.listen("App\\Events\\FormVersionUpdateEvent", onUpdate);
    }
  } catch (error) {
    console.error("Error setting up channel listeners:", error);
  }
};

const ExternalPreviewPage = () => {
  const { id } = useParams<URLParams>();
  const formVersionID = id;
  const navigate = useNavigate();

  const urlParams = new URLSearchParams(window.location.search);
  const isDraft = urlParams.get("draft") === "true";

  const [formData, setFormData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const echoRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);

  // Get form data from API
  const fetchFormData = async (isRealTimeUpdate = false) => {
    try {
      if (!isRealTimeUpdate) {
        setLoading(true);
      }

      const url = `${API.getFormById}${formVersionID}/data${
        isDraft ? "?draft=true" : ""
      }`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch form data: ${response.status} ${response.statusText}`
        );
      }

      const apiData = (await response.json()) as ApiDataResponse;

      if (isRealTimeUpdate) {
        setFormData((prevFormData) => {
          if (!prevFormData) return prevFormData;

          const newFormDefinition = apiData.form_template;
          const definitionChanged =
            JSON.stringify(newFormDefinition) !==
            JSON.stringify(prevFormData.form_definition);

          if (!definitionChanged) {
            return prevFormData;
          }

          return {
            ...prevFormData,
            form_definition: newFormDefinition,
            logs: apiData.logs,
          };
        });
      } else {
        const transformedData = transformApiResponse(apiData);
        setFormData(transformedData);
        setError(null);
      }
    } catch (err) {
      console.error(
        `Error fetching form data${isRealTimeUpdate ? " (real-time)" : ""}:`,
        err
      );
      if (!isRealTimeUpdate) {
        setError(
          err instanceof Error ? err.message : "An unknown error occurred"
        );
      }
    } finally {
      if (!isRealTimeUpdate) {
        setLoading(false);
      }
    }
  };

  // Extract connection event handlers
  const setupConnectionHandlers = (echoInstance: any) => {
    if (!isPusherConnector(echoInstance.connector)) return;

    const pusherConnection = echoInstance.connector.pusher?.connection;

    pusherConnection.bind("connected", () => {
      const socketId = getSocketId(echoInstance);
      if (socketId) {
        setConnectionStatus("connected");
      } else {
        setTimeout(() => {
          if (getSocketId(echoInstance)) {
            setConnectionStatus("connected");
          }
        }, 1000);
      }
    });

    pusherConnection.bind("disconnected", () =>
      setConnectionStatus("disconnected")
    );
    pusherConnection.bind("error", (err: any) => {
      console.error("WebSocket error:", err);
      setConnectionStatus("error");
    });
    pusherConnection.bind("unavailable", () => {
      console.warn("WebSocket unavailable");
      setConnectionStatus("error");
    });
  };

  // Initialize Laravel Echo websocket connection
  const initializeEcho = async () => {
    try {
      globalInitializing = true;
      setConnectionStatus("connecting");

      const echoInstance = new Echo({
        broadcaster: "reverb",
        key: import.meta.env.VITE_REVERB_APP_KEY,
        wsHost: import.meta.env.VITE_REVERB_HOST || "localhost",
        wsPort: Number(import.meta.env.VITE_REVERB_PORT) || 8080,
        wssPort: Number(import.meta.env.VITE_REVERB_PORT) || 8080,
        forceTLS: (import.meta.env.VITE_REVERB_SCHEME || "http") === "https",
        enabledTransports: ["ws", "wss"],
        disableStats: true,
      });

      echoRef.current = echoInstance;
      globalEchoInstance = echoInstance;
      setupConnectionHandlers(echoInstance);
    } catch (error) {
      console.error("Failed to initialize Echo:", error);
      setConnectionStatus("error");
      globalEchoInstance = null;
    } finally {
      globalInitializing = false;
    }
  };

  // Initial data fetch
  useEffect(() => {
    if (!formVersionID) {
      setError('No form ID provided. Please include an "id" query parameter.');
      setLoading(false);
      return;
    }
    fetchFormData();
  }, [formVersionID]);

  // Initialize Echo connection and handle subscriptions
  useEffect(() => {
    if (!formVersionID) return;
    if (!globalEchoInstance && !globalInitializing) {
      initializeEcho();
    } else if (globalEchoInstance || globalInitializing) {
      echoRef.current = globalEchoInstance;
      if (globalEchoInstance?.connector?.pusher?.connection?.socket_id) {
        setConnectionStatus("connected");
      }
    }

    // Set up subscription when connected
    if (echoRef.current && connectionStatus === "connected") {
      const socketId = getSocketId(echoRef.current);
      if (socketId) {
        const subscribeTimer = setTimeout(() => {
          const channelName = isDraft
            ? `draft-form-version.${formVersionID}`
            : `form-version.${formVersionID}`;

          const channel = echoRef.current.channel(channelName);
          setupChannelEventBindings(channel, () => fetchFormData(true));
          subscriptionRef.current = channel;
        }, 500);

        return () => {
          clearTimeout(subscribeTimer);
          if (echoRef.current && formVersionID && subscriptionRef.current) {
            try {
              const channelName = isDraft
                ? `draft-form-version.${formVersionID}`
                : `form-version.${formVersionID}`;
              echoRef.current.leave(channelName);
            } catch (error) {
              console.error("Error leaving channel:", error);
            }
            subscriptionRef.current = null;
          }
        };
      }
    }

    return () => {
      echoRef.current = null;
    };
  }, [formVersionID, connectionStatus, isDraft]);

  const goBack = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <InlineLoading description="Loading form..." status="active" />
        <div
          style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6f6f6f" }}
        >
          WebSocket:{" "}
          <span style={{ color: getConnectionStatusColor(connectionStatus) }}>
            {connectionStatus}
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <InlineNotification kind="error" title="Error" subtitle={error} />
        <Button onClick={goBack} style={{ marginTop: "1rem" }}>
          Go Back
        </Button>
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="error-container">
        <InlineNotification
          kind="error"
          title="No Data"
          subtitle="No form data was returned from the API."
        />
        <Button onClick={goBack} style={{ marginTop: "1rem" }}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="preview-container">
      {isDraft && (
        <div
          style={{
            backgroundColor: "#ff6b35",
            color: "white",
            padding: "8px 16px",
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "0.875rem",
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1001,
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            display: "block",
          }}
          className="draft-banner"
        >
          <style>{`.draft-banner { @media print { display: none !important; } }`}</style>
          🚧 DRAFTING VERSION
        </div>
      )}
      <div
        style={{
          position: "fixed",
          top: "10px",
          right: "10px",
          zIndex: 1000,
          fontSize: "0.75rem",
          padding: "4px 8px",
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          border: "1px solid #e0e0e0",
          borderRadius: "4px",
        }}
      >
        WS:{" "}
        <span style={{ color: getConnectionStatusColor(connectionStatus) }}>
          {connectionStatus}
        </span>
        <br />
        Mode: {isDraft ? "Viewing Draft" : ""}
        <br />
        Last Update: {new Date().toLocaleTimeString()}
      </div>
      <Presenter
        key={`${JSON.stringify(formData?.form_definition)}-${Date.now()}`}
        data={formData}
        mode="view"
        goBack={goBack}
      />
    </div>
  );
};

export default ExternalPreviewPage;
