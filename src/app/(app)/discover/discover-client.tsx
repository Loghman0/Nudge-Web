"use client";
import { DiscoverView } from "./discover-view";
import * as actions from "./actions";
import type { ComponentProps } from "react";
export function DiscoverClient(props: Omit<ComponentProps<typeof DiscoverView>, "actions">) {
  return <DiscoverView {...props} actions={actions} />;
}
