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

const ExternalPreviewPage = () => {
  const { id } = useParams<URLParams>();
  const formVersionID = id;
  const navigate = useNavigate();

  // Get draft parameter from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const isDraft = urlParams.get("draft") === "true";

  const [formData, setFormData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const echoRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);

  // Get CSRF token from Laravel app
  const getCSRFToken = async (): Promise<string> => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_LARAVEL_APP_URL}/sanctum/csrf-cookie`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        console.warn(`Failed to fetch CSRF token: ${response.status}`);
      }

      // Extract CSRF token from cookie or meta tag
      const cookies = document.cookie.split(";");
      const csrfCookie = cookies.find((cookie) =>
        cookie.trim().startsWith("XSRF-TOKEN=")
      );
      if (csrfCookie) {
        return decodeURIComponent(csrfCookie.split("=")[1]);
      }

      // Fallback to meta tag if available
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      return metaTag?.getAttribute("content") || "";
    } catch (error) {
      console.warn("Could not fetch CSRF token:", error);
      return "";
    }
  };

  // Fetch function extracted for reuse
  const fetchFormData = async () => {
    try {
      setLoading(true);
      // Add draft parameter to URL if needed
      const url = `${API.getFormById}${formVersionID}/data${
        isDraft ? "?draft=true" : ""
      }`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch form data: ${response.status} ${response.statusText}`
        );
      }
      const apiResponse = await response.json();

      const apiData = apiResponse as ApiDataResponse;
      const transformedData: FormData = {
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

      setFormData(transformedData);
      setError(null);
    } catch (err) {
      console.error("Error fetching form data:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  // New optimized function for real-time updates
  const fetchFormDefinitionOnly = async () => {
    try {
      // Don't show loading spinner for real-time updates
      // Add draft parameter to URL if needed
      const url = `${API.getFormById}${formVersionID}/data${
        isDraft ? "?draft=true" : ""
      }`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch form data: ${response.status} ${response.statusText}`
        );
      }
      const apiResponse = await response.json();

      const apiData = apiResponse as ApiDataResponse;

      // Only update the form definition, preserve existing data and state
      setFormData((prevFormData) => {
        if (!prevFormData) return prevFormData;

        const newFormDefinition = apiData.form_template;

        // Check if form definition actually changed
        const definitionChanged =
          JSON.stringify(newFormDefinition) !==
          JSON.stringify(prevFormData.form_definition);

        if (!definitionChanged) {
          return prevFormData;
        }

        return {
          ...prevFormData,
          form_definition: newFormDefinition,
          logs: apiData.logs, // Update logs too for consistency
        };
      });
    } catch (err) {
      console.error(
        "Error fetching form definition for real-time update:",
        err
      );
    }
  };

  useEffect(() => {
    if (!formVersionID) {
      setError('No form ID provided. Please include an "id" query parameter.');
      setLoading(false);
      return;
    }
    fetchFormData();
  }, [formVersionID]);

  // Initialize Echo and WebSocket connection
  useEffect(() => {
    if (!formVersionID) return;

    if (globalEchoInstance || globalInitializing) {
      echoRef.current = globalEchoInstance;
      if (globalEchoInstance?.connector?.pusher?.connection?.socket_id) {
        setConnectionStatus("connected");
      }
      return;
    }

    const initializeEcho = async () => {
      try {
        globalInitializing = true;
        setConnectionStatus("connecting");

        // Get CSRF token for authentication
        const csrfToken = await getCSRFToken();

        // Initialize Echo with Reverb configuration
        const echoInstance = new Echo({
          broadcaster: "reverb",
          key: import.meta.env.VITE_REVERB_APP_KEY,
          wsHost: import.meta.env.VITE_REVERB_HOST || "localhost",
          wsPort: Number(import.meta.env.VITE_REVERB_PORT) || 8080,
          wssPort: Number(import.meta.env.VITE_REVERB_PORT) || 8080,
          forceTLS: (import.meta.env.VITE_REVERB_SCHEME || "http") === "https",
          enabledTransports: ["ws", "wss"],
          disableStats: true,
          authEndpoint: `${
            import.meta.env.VITE_LARAVEL_APP_URL
          }/broadcasting/auth`,
          auth: {
            headers: {
              "X-CSRF-TOKEN": csrfToken,
              Accept: "application/json",
            },
          },
          // Add credentials for cross-origin requests
          authorizer: (channel: any) => {
            return {
              authorize: (socketId: string, callback: any) => {
                fetch(
                  `${import.meta.env.VITE_LARAVEL_APP_URL}/broadcasting/auth`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-CSRF-TOKEN": csrfToken,
                      Accept: "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({
                      socket_id: socketId,
                      channel_name: channel.name,
                    }),
                  }
                )
                  .then((response) => response.json())
                  .then((data) => callback(false, data))
                  .catch((error) => {
                    console.error("Auth error:", error);
                    callback(true, error);
                  });
              },
            };
          },
        });

        // Store references
        echoRef.current = echoInstance;
        globalEchoInstance = echoInstance;

        // Set up connection event listeners
        if (isPusherConnector(echoInstance.connector)) {
          const pusherConnection = echoInstance.connector.pusher?.connection;

          pusherConnection.bind("connected", () => {
            const socketId = getSocketId(echoInstance);

            // Set to connected when we have a socket ID
            if (socketId) {
              setConnectionStatus("connected");
            } else {
              setTimeout(() => {
                const retrySocketId = getSocketId(echoInstance);
                if (retrySocketId) {
                  setConnectionStatus("connected");
                }
              }, 1000);
            }
          });

          pusherConnection.bind("disconnected", () => {
            setConnectionStatus("disconnected");
          });

          pusherConnection.bind("error", (err: any) => {
            console.error("Reverb WebSocket error:", err);
            setConnectionStatus("error");
          });

          pusherConnection.bind("unavailable", () => {
            console.warn("Reverb WebSocket unavailable");
            setConnectionStatus("error");
          });
        }
      } catch (error) {
        console.error("Failed to initialize Echo:", error);
        setConnectionStatus("error");
        globalEchoInstance = null;
      } finally {
        globalInitializing = false;
      }
    };

    initializeEcho();

    return () => {
      echoRef.current = null;
    };
  }, [formVersionID]);

  // Subscribe to form version updates
  useEffect(() => {
    if (
      !formVersionID ||
      !echoRef.current ||
      connectionStatus !== "connected"
    ) {
      return;
    }

    // Double-check socket ID is available before subscribing
    const socketId = getSocketId(echoRef.current);
    if (!socketId) {
      return;
    }

    // Wait a bit to ensure connection is fully established
    const subscribeTimer = setTimeout(() => {
      // Choose channel based on draft parameter
      const channelName = isDraft
        ? `draft-form-version.${formVersionID}`
        : `form-version.${formVersionID}`;

      const channel = echoRef.current.channel(channelName);

      // Now try channel-specific events with proper error handling
      try {
        if (typeof channel.bind === "function") {
          // Add channel state listeners for debugging
          channel.bind("pusher:subscription_succeeded", (data: any) => {
            console.log(`✅ Successfully subscribed to ${channelName}:`, data);
          });

          channel.bind("pusher:subscription_error", (error: any) => {
            console.error(`❌ Subscription error for ${channelName}:`, error);
          });

          // Add debugging to channel level - this should catch channel-specific events
          if (typeof channel.bind_global === "function") {
            channel.bind_global((eventName: string) => {
              // If this is our target event, trigger the optimized fetch
              if (
                eventName === "App\\Events\\FormVersionUpdateEvent" ||
                eventName === "FormVersionUpdateEvent"
              ) {
                fetchFormDefinitionOnly();
              }
            });
          }

          // Try binding to the raw event name as it appears in the WebSocket message
          channel.bind("App\\Events\\FormVersionUpdateEvent", () => {
            fetchFormDefinitionOnly();
          });

          console.log("✅ Channel.bind listeners added successfully");
        } else {
          console.warn(
            "⚠️ channel.bind is not available, using alternative approach"
          );
        }
      } catch (error) {
        console.error("❌ Error setting up channel.bind listeners:", error);
      }

      // Try Laravel Echo's .listen() method with proper error handling
      try {
        if (typeof channel.listen === "function") {
          // Set up event listeners - simplified approach
          // The key insight is that Laravel Echo expects just the event name without namespace
          channel.listen("FormVersionUpdateEvent", () => {
            fetchFormDefinitionOnly(); // Use optimized function instead
          });

          // Also try with the full namespace just in case
          channel.listen("App\\Events\\FormVersionUpdateEvent", () => {
            fetchFormDefinitionOnly(); // Use optimized function instead
          });

          console.log("✅ Channel.listen listeners added successfully");
        } else {
          console.warn("⚠️ channel.listen is not available");
        }
      } catch (error) {
        console.error("❌ Error setting up channel.listen listeners:", error);
      }

      // Store the subscription reference
      subscriptionRef.current = channel;

      console.log(`✅ Event listeners set up for ${channelName}`);
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
  }, [formVersionID, connectionStatus, isDraft]);

  const goBack = () => {
    navigate(-1);
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "#24a148";
      case "connecting":
        return "#f1c21b";
      case "disconnected":
        return "#da1e28";
      case "error":
        return "#da1e28";
      default:
        return "#8a3ffc";
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <InlineLoading description="Loading form..." status="active" />
        <div
          style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6f6f6f" }}
        >
          WebSocket:{" "}
          <span style={{ color: getConnectionStatusColor() }}>
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
        <span style={{ color: getConnectionStatusColor() }}>
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
