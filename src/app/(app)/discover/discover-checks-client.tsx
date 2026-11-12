"use client";
import { DiscoverChecksView } from "./discover-checks-view";
import { answerVerification, confirmInsight } from "./actions";
import type { ComponentProps } from "react";

export function DiscoverChecksClient(props: Omit<ComponentProps<typeof DiscoverChecksView>, "actions">) {
  return <DiscoverChecksView {...props} actions={{ answerVerification, confirmInsight }} />;
}
