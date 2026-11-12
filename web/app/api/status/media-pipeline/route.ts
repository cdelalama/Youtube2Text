import { proxyPublicMediaStatus } from "../../../../lib/publicStatusProxy";

export async function GET(request: Request) {
  return proxyPublicMediaStatus(request);
}
