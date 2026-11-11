/**
 * opencode plugin: state the job-board hiring rule in the build agent's system prompt.
 *
 * Why unconditional: opencode's v2 plugin API cannot see tool results or change a single
 * request (checked against the installed @opencode-ai/plugin types). The only hook that can
 * change the prompt is the agent hook, which applies to every run of the agent. So this
 * rule applies to every opencode session that uses the build agent, not only to the
 * job-board skill. Install it only if that is what you want.
 */

/** The rule measured to hold pi to 0 of 16 hiring claims (round 18). Keep it verbatim. */
export const HIRING_RULE =
  "Do not state whether a company is hiring, and do not describe hiring trends, unless a " +
  "tool you ran in this session returned that data. If a tool could not read the company, " +
  "say so and stop. Do not fill the gap from memory or from web results.";

export default {
  id: "job-board-hiring-rule",
  setup: async (context) => {
    await context.agent.transform((draft) => {
      draft.update("build", (agent) => {
        agent.system = agent.system ? `${agent.system}\n\n${HIRING_RULE}` : HIRING_RULE;
      });
    });
  },
};
