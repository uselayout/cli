import { z } from "zod";
import { resolve } from "node:path";
import { scanCodebase, scanStorybook } from "../../integrations/codebase-scan.js";

export const name = "scan-project";

export const description =
  "Scan the current project for React components and Storybook stories. " +
  "Returns structured data about component names, props, export types, and story associations. " +
  "Use this to understand the existing component inventory before generating new components or design system context.";

export const inputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Directory to scan. Defaults to the current working directory."
    ),
  type: z
    .enum(["both", "storybook", "codebase"])
    .optional()
    .describe(
      "What to scan: 'both' (default) scans components and stories, 'storybook' scans only stories, 'codebase' scans only components."
    ),
};

type Input = {
  path?: string;
  type?: "both" | "storybook" | "codebase";
};

export function handler() {
  return async (input: Input) => {
    const rootPath = resolve(input.path ?? process.cwd());
    const scanType = input.type ?? "both";

    try {
      if (scanType === "storybook") {
        const stories = await scanStorybook(rootPath);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  type: "storybook-scan",
                  rootPath,
                  storiesFound: stories.length,
                  stories,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await scanCodebase(rootPath);

      // For "codebase" type, strip storybook data
      if (scanType === "codebase") {
        const components = result.components.map(
          ({ storybook: _sb, ...rest }) => rest
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  type: "codebase-scan",
                  rootPath,
                  componentsFound: components.length,
                  filesScanned: result.filesScanned,
                  durationMs: result.durationMs,
                  components,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Default: both
      const withStories = result.components.filter((c) => c.storybook);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                type: "full-scan",
                rootPath,
                summary: {
                  componentsFound: result.components.length,
                  storiesFound: result.storybookStories.length,
                  componentsWithStories: withStories.length,
                  unmatchedStories: result.unmatchedStories.length,
                  filesScanned: result.filesScanned,
                  durationMs: result.durationMs,
                },
                components: result.components,
                unmatchedStories: result.unmatchedStories,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error scanning project: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  };
}
