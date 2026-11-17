import "server-only";
import { cache } from "react";
import { getStrings, type Strings } from "@/strings";
import { getPreferences } from "./preferences";

/**
 * The copy pack for this request's device: Dumb Mode's when it is on (#28). Server components read
 * copy through this; client components use useStrings(), fed the same skin by the root layout.
 */
export const getRequestStrings = cache(async (): Promise<Strings> => getStrings((await getPreferences()).skin));
