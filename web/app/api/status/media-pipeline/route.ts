import { proxyPublicMediaStatus } from "../../../../lib/publicStatusProxy";

export async function GET() {
  return proxyPublicMediaStatus();
}
