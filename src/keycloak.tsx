import Keycloak from 'keycloak-js';
import type {
    KeycloakInstance,
    KeycloakInitOptions
    //KeycloakLoginOptions
} from 'keycloak-js';

//const redirectUri = window.location.href || (import.meta.env.VITE_SSO_REDIRECT_URI as string);

// const loginOptions: KeycloakLoginOptions = {
//     redirectUri,
//     idpHint: 'idir',
// };

// Keycloak instance - only create if not in standalone mode
let _kc: KeycloakInstance | null = null;

const createKeycloakInstance = (): KeycloakInstance => {
    if (!_kc) {
        _kc = new Keycloak({
            url: import.meta.env.VITE_SSO_AUTH_SERVER_URL as string,
            realm: import.meta.env.VITE_SSO_REALM as string,
            clientId: import.meta.env.VITE_SSO_CLIENT_ID as string,
        });
    }
    return _kc;
};

// Initialize Keycloak and return the instance if authenticated.
export const initializeKeycloak = async (): Promise<KeycloakInstance | void> => {
    // Skip initialization if in standalone mode
    if (import.meta.env.VITE_STANDALONE_MODE === 'true') {
        return;
    }

    try {
        const kc = createKeycloakInstance();
        
        // Set the token expiration handler.
        kc.onTokenExpired = () => {
            // Optionally, specify a minimum validity (in seconds) to refresh.
            kc.updateToken(5).catch((err: unknown) => console.error('Failed to update token:', err));
        };

        const initOptions: KeycloakInitOptions = {
            pkceMethod: 'S256',
            checkLoginIframe: false,
            onLoad: 'check-sso'
            //silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`
        };

        // console.log("Initializing Keycloak...");
        await kc.init(initOptions);
        //console.log("Authentication status:", auth); // Debugging step

        if (window.location.search.includes("code=") || window.location.search.includes("state=")) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // if (kc.authenticated) {
        //     console.log("Authenticated successfully.");
        // } else {
        //     console.warn("Not authenticated. Will handle login via PrivateRoute.");
        // }

        return kc;
    } catch (err: unknown) {
        //console.error("Keycloak init failed:", err);
        const kc = createKeycloakInstance();
        return kc;
    }
};

// Custom logout function to trigger logout via Siteminder.
export const logout = (): void => {
    // Skip logout if in standalone mode
    if (import.meta.env.VITE_STANDALONE_MODE === 'true') {
        return;
    }

    const ssoAuthServer = import.meta.env.VITE_SSO_AUTH_SERVER_URL as string;
    const ssoRealm = import.meta.env.VITE_SSO_REALM as string;
    const ssoRedirectUri = import.meta.env.VITE_SSO_REDIRECT_URI as string;
    const ssoClientId = import.meta.env.VITE_SSO_CLIENT_ID as string;

    const retUrl = `${ssoAuthServer}/realms/${ssoRealm} /protocol/openid - connect / logout ? post_logout_redirect_uri = ${ssoRedirectUri}& client_id=${ssoClientId} `;

    window.location.href = `https://logon7.gov.bc.ca/clp-cgi/logoff.cgi?retnow=1&returl=${encodeURIComponent(retUrl)}`;
};