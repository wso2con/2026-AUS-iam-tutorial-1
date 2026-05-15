import QRCode from 'qrcode';
import { buildDcqlQuery } from './presentation-definition';

export function buildRequestUri(requestId: string, appBaseUrl: string): string {
  return `${appBaseUrl}/openid4vp/authorization-request/${encodeURIComponent(requestId)}`;
}

export function buildCallbackUri(appBaseUrl: string): string {
  return `${appBaseUrl}/openid4vp/authorization-response`;
}

export function buildLissiRequestUriDeepLink(requestUri: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    request_uri: requestUri,
    request_uri_method: 'post'
  });

  return `openid4vp://?${params.toString()}`;
}

export function buildDcqlQueryFromConfig(input: {
  credentialId: string;
  vctValues: string[];
  claims: Array<{ id: string; path: string[] }>;
}) {
  return buildDcqlQuery(input);
}

export async function buildQrDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280
  });
}
