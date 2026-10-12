// Conventional Commits voor projecten in de pipeline, geïnstalleerd vanuit de control-plane.
// Extra regel: geen co-author-trailer en geen verwijzing naar het gebruikte gereedschap
// (CLAUDE.md van de control-plane, Vaste principes 8).
const FORBIDDEN = /co-authored-by|claude/i;

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-tool-attribution": ({ raw }) => [
          !FORBIDDEN.test(raw || ""),
          "geen co-authored-by-trailer en geen verwijzing naar het gebruikte gereedschap",
        ],
      },
    },
  ],
  rules: {
    "no-tool-attribution": [2, "always"],
  },
};
