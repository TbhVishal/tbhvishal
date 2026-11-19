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
    const avatarUrl = `https://github.com/${r.owner}.png?size=40`;
    const starText = r.stars > 0 ? `&nbsp;<sub><img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Glowing%20Star.png" width="14" height="14" align="absmiddle" alt="" /> ${formatStars(r.stars)}</sub>` : "";
    const prLinks = r.prs
      .map((p) => `<a href="${p.url}">${sanitize(p.title)} (#${p.number})</a>`)
      .join("<br/>");
    const badge = defaultStatus === "MERGED"
      ? `<img src="https://img.shields.io/badge/Merged-8957E5?style=flat-square&logo=github&logoColor=white" alt="Merged" />`
      : `<img src="https://img.shields.io/badge/Open_PR-238636?style=flat-square&logo=github&logoColor=white" alt="Open PR" />`;

    rows += `      <tr>\n`;
    rows += `        <td align="left">\n`;
    rows += `          <img src="${avatarUrl}" width="22" height="22" align="absmiddle" style="border-radius: 4px;" />\n`;
    rows += `          &nbsp;<b><a href="https://github.com/${r.nameWithOwner}">${r.nameWithOwner}</a></b>${starText}\n`;
    rows += `        </td>\n`;
    rows += `        <td align="left">\n`;
    rows += `          ${prLinks}\n`;
    rows += `        </td>\n`;
    rows += `        <td align="center">\n`;
    rows += `          ${badge}\n`;
    rows += `        </td>\n`;
    rows += `      </tr>\n`;
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

  const TOP_MERGED_LIMIT = 10;
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
    out += `        <th align="left" width="35%">Project</th>\n`;
    out += `        <th align="left" width="50%">Pull Request</th>\n`;
    out += `        <th align="center" width="15%">Status</th>\n`;
    out += `      </tr>\n`;
    out += `    </thead>\n`;
    out += `    <tbody>\n`;
    out += renderRepoRows(visibleMerged, "MERGED");
    out += `    </tbody>\n`;
    out += `  </table>\n`;
    out += `</div>\n\n`;
  }

  // 2. Expandable Dropdown for In-Review & Remaining Contributions
  if (totalHidden > 0) {
    out += `<div align="center">\n`;
    out += `  <details>\n`;
    out += `    <summary>\n`;
    out += `      <b>\n`;
    out += `        <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Card%20File%20Box.png" width="22" height="22" align="absmiddle" alt="" />\n`;
    out += `        &nbsp;Click to expand in-review & remaining contributions (${totalHidden} repositories)\n`;
    out += `      </b>\n`;
    out += `    </summary>\n`;
    out += `    <br/>\n`;
    out += `    <table width="100%">\n`;
    out += `      <thead>\n`;
    out += `        <tr>\n`;
    out += `          <th align="left" width="35%">Project</th>\n`;
    out += `          <th align="left" width="50%">Pull Request</th>\n`;
    out += `          <th align="center" width="15%">Status</th>\n`;
    out += `        </tr>\n`;
    out += `      </thead>\n`;
    out += `      <tbody>\n`;
    if (activeRepos.length > 0) {
      out += renderRepoRows(activeRepos, "OPEN");
    }
    if (hiddenMerged.length > 0) {
      out += renderRepoRows(hiddenMerged, "MERGED");
    }
    out += `      </tbody>\n`;
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
      url: "https://github-readme-stats-one-taupe.vercel.app/api?username=tbhvishal&show_icons=true&include_all_commits=true&count_private=true&bg_color=00000000&hide_border=true&title_color=FED11E&icon_color=FED11E&text_color=c9d1d9&text_bold=false",
    },
    {
      file: "top-langs.svg",
      url: "https://github-readme-stats-one-taupe.vercel.app/api/top-langs?username=tbhvishal&layout=compact&bg_color=00000000&hide_border=true&title_color=FED11E&text_color=c9d1d9&text_bold=false",
    },
    {
      file: "streak-stats.svg",
      url: "https://streak-stats.demolab.com/?user=tbhvishal&hide_border=true&background=00000000&ring=FED11E&fire=FED11E&currStreakNum=FED11E&currStreakLabel=FED11E&sideNums=c9d1d9&sideLabels=8b949e&dates=8b949e",
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
  const insertBlock = `<h2 align="center">\n  <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Laptop.png" width="38" height="38" align="absmiddle" alt="" />\n  &nbsp;Open Source Contributions\n</h2>\n\n${generatedSection}\n\n---\n\n`;

  // Remove existing section if present anywhere
  const headingRegex = /<h2 align="center">\s*<img[^>]*Laptop\.png[^>]*>[\s\S]*?<!-- RECENT_CONTRIBUTIONS:END -->\s*(---\s*)?/i;
  if (headingRegex.test(readme)) {
    readme = readme.replace(headingRegex, "");
  }

  // Insert right before Connect with Me (Handshake.png)
  const handshakeMarker = "Handshake.png";
  const handshakeIndex = readme.indexOf(handshakeMarker);
  if (handshakeIndex !== -1) {
    const h2Prefix = '<h2 align="center">';
    const insertPos = readme.lastIndexOf(h2Prefix, handshakeIndex);
    if (insertPos !== -1) {
      readme = readme.slice(0, insertPos) + insertBlock + readme.slice(insertPos);
    } else {
      readme += `\n\n${insertBlock}`;
    }
  } else {
    readme += `\n\n${insertBlock}`;
  }

  fs.writeFileSync(readmePath, readme, "utf-8");
  console.log("Successfully updated README.md with live open-source contributions in proper position!");
}

run().catch((err) => {
  console.error("Failed to update contributions:", err);
  process.exit(1);
});
