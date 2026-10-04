import { adminOverview } from "@/lib/admin.functions";

export const overviewQuery = { queryKey: ["dash", "overview"], queryFn: () => adminOverview() };
