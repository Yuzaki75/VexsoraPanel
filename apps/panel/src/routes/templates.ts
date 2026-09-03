import { Hono } from "hono";
import { listTemplates } from "../templates.js";
import { requireAuth, type AppEnv } from "../auth/middleware.js";

const templatesRouter = new Hono<AppEnv>();
templatesRouter.use("*", requireAuth);

templatesRouter.get("/", (c) => {
  const templates = listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    game: t.game,
    description: t.description,
    dockerImage: t.dockerImage,
    variables: t.variables,
    minMemoryMb: t.minMemoryMb,
    minDiskMb: t.minDiskMb,
  }));
  return c.json({ templates });
});

export default templatesRouter;
