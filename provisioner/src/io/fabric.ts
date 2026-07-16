import { FABRIC_META } from "../pins.js";

/**
 * The Fabric meta "server/jar" endpoint serves a ready-to-run launcher jar —
 * no installer invocation needed. Paired with fabric-server-launcher.properties
 * (serverJar=server.jar) it boots the Mojang jar through Fabric Loader.
 */
export function fabricServerLauncherUrl(mcVersion: string, loaderVersion: string, installerVersion: string): string {
  return `${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(
    loaderVersion,
  )}/${encodeURIComponent(installerVersion)}/server/jar`;
}
