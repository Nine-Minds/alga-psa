
import axios from 'axios';
import qs from 'querystring';
import logger from 'server/src/utils/logger';

const keycloakConfig = {
    url: process.env.KEYCLOAK_URL,
    realm: process.env.KEYCLOAK_REALM,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  };


export async function getKeycloakToken(username: string, password: string) {
    const tokenEndpoint = `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`;
    logger.info("Token Endpoint:", tokenEndpoint);
    const data = qs.stringify({
    client_id: keycloakConfig.clientId,
    client_secret: keycloakConfig.clientSecret,
    grant_type: 'password',
    username: username,
    password: password,
    });

    try {
    const response = await axios.post(tokenEndpoint, data, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            // Log only relevant error information
            logger.error("Failed to get Keycloak user info:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
        } else {
            logger.error("Failed to get Keycloak user info:", error);
        }
        return null;
    }
}
