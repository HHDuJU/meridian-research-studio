/*
 * Meridian on Cowork: the root route. The server build's root renders the whole document (html, head,
 * sign-in provider, preview bridge); inside a Claude artifact the platform owns the document, so this
 * root renders only the pages and the notifications.
 */
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "../components/ui/sonner";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
});
