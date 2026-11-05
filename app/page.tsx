import { HomeRedirect } from "@/components/HomeRedirect";

// The app root is a client hop to this device's last visited page — see
// components/HomeRedirect. Deliberately outside the (app) group so no navbar
// or data-loader chrome mounts for the hop.
export default function RootPage() {
  return <HomeRedirect />;
}
