import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const USERNAME = "tbhvishal";
const TOKEN = process.env.GITHUB_TOKEN || getLocalToken();

function getLocalToken() {
  try {
    return execSync("gh auth token", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function fetchPullRequests() {
  if (!TOKEN) {
    console.warn("No GitHub token available. Skipping API fetch.");
    return null;
  }

  const query = `
    query($username: String!) {
      user(login: $username) {
        pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes {
            title
            number
            url
            state
            mergedAt
            createdAt
            repository {
              nameWithOwner
              stargazerCount
              owner {
                login
                avatarUrl
              }
              isFork
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "tbhvishal-profile-readme",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables: { username: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data.user.pullRequests.nodes;
}

function formatStars(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + "k";
  }
  return count.toString();
}

function sanitize(text) {
  return (text || "").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderRepoRows(repoList, defaultStatus) {
  let rows = "";
  for (const r of repoList) {
    const avatarUrl = `https://github.com/${r.owner}.png?size=64`;
    const starText = r.stars > 0 ? `&nbsp;<sub>⭐&nbsp;${formatStars(r.stars)}</sub>` : "";
    const MAX_PR_SHOWN = 2;
    const visiblePrs = r.prs
      .slice(0, MAX_PR_SHOWN)
      .map((p) => `<a href="${p.url}">${sanitize(p.title)} (#${p.number})</a>`);
    if (r.prs.length > MAX_PR_SHOWN) {
      const extraCount = r.prs.length - MAX_PR_SHOWN;
      const authorFilterUrl = `https://github.com/${r.nameWithOwner}/pulls?q=author%3A${USERNAME}`;
      visiblePrs.push(`<a href="${authorFilterUrl}"><sub><b>+${extraCount} more contribution${extraCount > 1 ? "s" : ""} &rarr;</b></sub></a>`);
    }
    const prLinks = visiblePrs.join("<br/>");
    const badge = defaultStatus === "MERGED"
      ? `<img src="https://img.shields.io/badge/Merged-8957E5?style=flat-square&logo=github&logoColor=white" alt="Merged" />`
      : `<img src="https://img.shields.io/badge/Open_PR-238636?style=flat-square&logo=github&logoColor=white" alt="Open PR" />`;

    const displayName = r.nameWithOwner.replace("/", "/&#8203;");

    rows += `    <tbody>\n`;
    rows += `      <tr>\n`;
    rows += `        <td align="left" width="34%">\n`;
    rows += `          <img src="${avatarUrl}" width="28" height="28" align="absmiddle" style="border-radius: 6px;" />\n`;
    rows += `          &nbsp;<b><a href="https://github.com/${r.nameWithOwner}">${displayName}</a></b>${starText}\n`;
    rows += `        </td>\n`;
    rows += `        <td align="left" width="52%">\n`;
    rows += `          ${prLinks}\n`;
    rows += `        </td>\n`;
    rows += `        <td align="center" width="14%" nowrap>\n`;
    rows += `          ${badge}\n`;
    rows += `        </td>\n`;
    rows += `      </tr>\n`;
    rows += `    </tbody>\n`;
  }
  return rows;
}

function generateMarkdown(nodes) {
  if (!nodes || nodes.length === 0) return "";

  // Filter out own repositories and closed PRs
  const valid = nodes.filter((pr) => {
    if (!pr.repository) return false;
    const owner = pr.repository.owner?.login?.toLowerCase() || "";
    if (owner === USERNAME.toLowerCase()) return false;
    if (pr.state === "CLOSED") return false;
    return true;
  });

  // Group by repository
  const repoMap = new Map();
  for (const pr of valid) {
    const repoName = pr.repository.nameWithOwner;
    if (!repoMap.has(repoName)) {
      repoMap.set(repoName, {
        nameWithOwner: repoName,
        owner: pr.repository.owner?.login || repoName.split("/")[0],
        stars: pr.repository.stargazerCount || 0,
        prs: [],
      });
    }
    repoMap.get(repoName).prs.push(pr);
  }

  const repos = Array.from(repoMap.values());
  repos.sort((a, b) => b.stars - a.stars);

  const mergedRepos = [];
  const activeRepos = [];

  for (const r of repos) {
    const mergedPrs = r.prs.filter((p) => p.state === "MERGED");
    const openPrs = r.prs.filter((p) => p.state === "OPEN");

    if (mergedPrs.length > 0) {
      mergedRepos.push({ ...r, prs: mergedPrs });
    }
    if (openPrs.length > 0) {
      activeRepos.push({ ...r, prs: openPrs });
    }
  }

  const TOP_MERGED_LIMIT = 8;
  const visibleMerged = mergedRepos.slice(0, TOP_MERGED_LIMIT);
  const hiddenMerged = mergedRepos.slice(TOP_MERGED_LIMIT);

  // All active in-review PRs and overflow merged PRs go into the expandable dropdown
  const totalHidden = hiddenMerged.length + activeRepos.length;

  let out = `<!-- RECENT_CONTRIBUTIONS:START -->\n`;
  out += `<p align="center">\n`;
  out += `  <a href="https://github.com/search?q=author%3Atbhvishal+type%3Apr+is%3Amerged">\n`;
  out += `    <img src="https://img.shields.io/badge/Status-Active_Contributor-2ea44f?style=for-the-badge&logo=github&logoColor=white" alt="Active Contributor" />\n`;
  out += `  </a>\n`;
  out += `  &nbsp;&nbsp;\n`;
  out += `  <img src="https://img.shields.io/badge/Code-Merged_to_Production-8957E5?style=for-the-badge&logo=git&logoColor=white" alt="Merged to Production" />\n`;
  out += `</p>\n\n`;

  // 1. Top 10 Merged Pull Requests (Production Code)
  if (visibleMerged.length > 0) {
    out += `<div align="center">\n`;
    out += `  <table width="100%">\n`;
    out += `    <thead>\n`;
    out += `      <tr>\n`;
    out += `        <th align="left" width="34%">Project</th>\n`;
    out += `        <th align="left" width="52%">Pull Request</th>\n`;
    out += `        <th align="center" width="14%" nowrap>Status</th>\n`;
    out += `      </tr>\n`;
    out += `    </thead>\n`;
    out += renderRepoRows(visibleMerged, "MERGED");
    out += `  </table>\n`;
    out += `</div>\n\n`;
  }

  // 2. Expandable Dropdown for In-Review & Remaining Contributions
  if (totalHidden > 0) {
    out += `<div align="center">\n`;
    out += `  <details>\n`;
    out += `    <summary>\n`;
    out += `      <b>\n`;
    out += `        Click to expand in-review & remaining contributions (${totalHidden} repositories)\n`;
    out += `      </b>\n`;
    out += `    </summary>\n`;
    out += `    <br/>\n`;
    out += `    <table width="100%">\n`;
    out += `      <thead>\n`;
    out += `        <tr>\n`;
    out += `          <th align="left" width="34%">Project</th>\n`;
    out += `          <th align="left" width="52%">Pull Request</th>\n`;
    out += `          <th align="center" width="14%" nowrap>Status</th>\n`;
    out += `        </tr>\n`;
    out += `      </thead>\n`;
    if (activeRepos.length > 0) {
      out += renderRepoRows(activeRepos, "OPEN");
    }
    if (hiddenMerged.length > 0) {
      out += renderRepoRows(hiddenMerged, "MERGED");
    }
    out += `    </table>\n`;
    out += `  </details>\n`;
    out += `</div>\n`;
  }

  out += `<!-- RECENT_CONTRIBUTIONS:END -->`;

  return out;
}

async function updateStatsSvgs() {
  const statsDir = path.resolve(process.cwd(), "assets", "stats");
  if (!fs.existsSync(statsDir)) {
    fs.mkdirSync(statsDir, { recursive: true });
  }

  const targets = [
    {
      file: "github-stats.svg",
      url: "https://github-readme-stats-one-taupe.vercel.app/api?username=tbhvishal&show_icons=true&include_all_commits=true&count_private=true&bg_color=0d1117&border_color=30363d&title_color=58a6ff&icon_color=58a6ff&text_color=c9d1d9&border_radius=8",
    },
    {
      file: "top-langs.svg",
      url: "https://github-readme-stats-one-taupe.vercel.app/api/top-langs?username=tbhvishal&layout=compact&bg_color=0d1117&border_color=30363d&title_color=58a6ff&text_color=c9d1d9&border_radius=8",
    },
    {
      file: "streak-stats.svg",
      url: "https://streak-stats.demolab.com/?user=tbhvishal&background=0d1117&border=30363d&stroke=30363d&ring=58a6ff&fire=58a6ff&currStreakNum=58a6ff&currStreakLabel=58a6ff&sideNums=c9d1d9&sideLabels=8b949e&dates=8b949e&border_radius=8",
    },
    {
      file: "trophies.svg",
      url: "https://github-profile-repo.vercel.app/?username=tbhvishal&theme=darkhub&row=1&column=7&margin-h=15&margin-w=5&no-bg=true",
    },
  ];

  await Promise.all(
    targets.map(async (t) => {
      try {
        const res = await fetch(t.url);
        if (res.ok) {
          const svg = await res.text();
          if (svg.includes("<svg")) {
            fs.writeFileSync(path.join(statsDir, t.file), svg, "utf-8");
            console.log(`Updated assets/stats/${t.file}`);
          }
        }
      } catch (err) {
        console.warn(`Could not update ${t.file}, keeping cached version:`, err.message);
      }
    })
  );
}

async function run() {
  const readmePath = path.resolve(process.cwd(), "README.md");
  if (!fs.existsSync(readmePath)) {
    console.error(`README.md not found at ${readmePath}`);
    process.exit(1);
  }

  // Update cached SVGs
  await updateStatsSvgs();

  let readme = fs.readFileSync(readmePath, "utf-8");
  const nodes = await fetchPullRequests();
  if (!nodes || nodes.length === 0) {
    console.log("No external pull requests found.");
    return;
  }

  const generatedSection = generateMarkdown(nodes);

  const startMarker = "<!-- RECENT_CONTRIBUTIONS:START -->";
  const endMarker = "<!-- RECENT_CONTRIBUTIONS:END -->";
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);

  if (startIndex !== -1 && endIndex !== -1) {
    readme = readme.slice(0, startIndex) + generatedSection + readme.slice(endIndex + endMarker.length);
  } else {
    console.warn("Could not find RECENT_CONTRIBUTIONS markers in README.md");
  }

  fs.writeFileSync(readmePath, readme, "utf-8");
  console.log("Successfully updated README.md with live open-source contributions in proper position!");
}

run().catch((err) => {
  console.error("Failed to update contributions:", err);
  process.exit(1);
});
