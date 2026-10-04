import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { getEnv } from "./env.server";

export const getDb = () => drizzle(getEnv().DB, { schema });
export type Db = ReturnType<typeof getDb>;
export { schema };
