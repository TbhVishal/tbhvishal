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

  let out = `<!-- RECENT_CONTRIBUTIONS:START -->\n`;
  out += `<p align="center">\n`;
  out += `  <a href="https://github.com/search?q=author%3Atbhvishal+type%3Apr+is%3Amerged">\n`;
  out += `    <img src="https://img.shields.io/badge/Status-Active_Contributor-2ea44f?style=for-the-badge&logo=github&logoColor=white" alt="Active Contributor" />\n`;
  out += `  </a>\n`;
  out += `  &nbsp;&nbsp;\n`;
  out += `  <img src="https://img.shields.io/badge/Code-Merged_to_Production-8957E5?style=for-the-badge&logo=git&logoColor=white" alt="Merged to Production" />\n`;
  out += `</p>\n\n`;

  // 1. Merged Pull Requests
  out += `### 🏁 Merged Pull Requests (Production Code)\n\n`;
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

  for (const r of mergedRepos) {
    const avatarUrl = `https://github.com/${r.owner}.png?size=40`;
    const starText = r.stars > 0 ? `&nbsp;<sub>⭐ ${formatStars(r.stars)}</sub>` : "";
    const prLinks = r.prs
      .map((p) => `<a href="${p.url}">${sanitize(p.title)} (#${p.number})</a>`)
      .join("<br/>");

    out += `      <tr>\n`;
    out += `        <td align="left">\n`;
    out += `          <img src="${avatarUrl}" width="22" height="22" align="absmiddle" style="border-radius: 4px;" />\n`;
    out += `          &nbsp;<b><a href="https://github.com/${r.nameWithOwner}">${r.nameWithOwner}</a></b>${starText}\n`;
    out += `        </td>\n`;
    out += `        <td align="left">\n`;
    out += `          ${prLinks}\n`;
    out += `        </td>\n`;
    out += `        <td align="center">\n`;
    out += `          <img src="https://img.shields.io/badge/Merged-8957E5?style=flat-square&logo=github&logoColor=white" alt="Merged" />\n`;
    out += `        </td>\n`;
    out += `      </tr>\n`;
  }
  out += `    </tbody>\n`;
  out += `  </table>\n`;
  out += `</div>\n\n`;

  // 2. Active Contributions
  out += `### 🟢 Active Contributions (Under Review)\n\n`;
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

  for (const r of activeRepos) {
    const avatarUrl = `https://github.com/${r.owner}.png?size=40`;
    const starText = r.stars > 0 ? `&nbsp;<sub>⭐ ${formatStars(r.stars)}</sub>` : "";
    const prLinks = r.prs
      .map((p) => `<a href="${p.url}">${sanitize(p.title)} (#${p.number})</a>`)
      .join("<br/>");

    out += `      <tr>\n`;
    out += `        <td align="left">\n`;
    out += `          <img src="${avatarUrl}" width="22" height="22" align="absmiddle" style="border-radius: 4px;" />\n`;
    out += `          &nbsp;<b><a href="https://github.com/${r.nameWithOwner}">${r.nameWithOwner}</a></b>${starText}\n`;
    out += `        </td>\n`;
    out += `        <td align="left">\n`;
    out += `          ${prLinks}\n`;
    out += `        </td>\n`;
    out += `        <td align="center">\n`;
    out += `          <img src="https://img.shields.io/badge/Open_PR-238636?style=flat-square&logo=github&logoColor=white" alt="Open PR" />\n`;
    out += `        </td>\n`;
    out += `      </tr>\n`;
  }
  out += `    </tbody>\n`;
  out += `  </table>\n`;
  out += `</div>\n\n`;

  // 3. Discussion Solutions Archive
  out += `<div align="center">\n`;
  out += `  <details>\n`;
  out += `    <summary><b>📂 Click here to view Galaxy Brain community solutions and discussion answers</b></summary>\n`;
  out += `    <br/>\n`;
  out += `    <table width="100%">\n`;
  out += `      <thead>\n`;
  out += `        <tr>\n`;
  out += `          <th align="left">Repository</th>\n`;
  out += `          <th align="left">Solution Details</th>\n`;
  out += `          <th align="center">Category</th>\n`;
  out += `        </tr>\n`;
  out += `      </thead>\n`;
  out += `      <tbody>\n`;
  out += `        <tr>\n`;
  out += `          <td><a href="https://github.com/meta/docusaurus">meta/docusaurus</a></td>\n`;
  out += `          <td><a href="https://github.com/meta/docusaurus/discussions/13078#discussioncomment-19720252">Dynamic docs sidebar registration architecture solution (#13078)</a></td>\n`;
  out += `          <td align="center"><img src="https://img.shields.io/badge/Galaxy_Brain-FED11E?style=flat-square&logo=github&logoColor=black" alt="Discussion Answer"/></td>\n`;
  out += `        </tr>\n`;
  out += `      </tbody>\n`;
  out += `    </table>\n`;
  out += `  </details>\n`;
  out += `</div>\n`;
  out += `<!-- RECENT_CONTRIBUTIONS:END -->`;

  return out;
}

async function run() {
  const readmePath = path.resolve(process.cwd(), "README.md");
  if (!fs.existsSync(readmePath)) {
    console.error(`README.md not found at ${readmePath}`);
    process.exit(1);
  }

  let readme = fs.readFileSync(readmePath, "utf-8");
  const nodes = await fetchPullRequests();
  if (!nodes || nodes.length === 0) {
    console.log("No external pull requests found.");
    return;
  }

  const generatedSection = generateMarkdown(nodes);

  const startMarker = "<!-- RECENT_CONTRIBUTIONS:START -->";
  const endMarker = "<!-- RECENT_CONTRIBUTIONS:END -->";

  if (readme.includes(startMarker) && readme.includes(endMarker)) {
    const startIndex = readme.indexOf(startMarker);
    const endIndex = readme.indexOf(endMarker) + endMarker.length;
    readme = readme.slice(0, startIndex) + generatedSection + readme.slice(endIndex);
  } else {
    // Look for Achievements section marker: "Party%20Popper.png"
    const markerIndex = readme.indexOf("Party%20Popper.png");
    const h2Prefix = '<h2 align="center">';
    let insertIndex = -1;
    if (markerIndex !== -1) {
      insertIndex = readme.lastIndexOf(h2Prefix, markerIndex);
    }

    const insertBlock = `<h2 align="center">\n  <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Laptop.png" width="38" height="38" align="absmiddle" alt="" />\n  &nbsp;Open Source Contributions\n</h2>\n\n${generatedSection}\n\n---\n\n`;

    if (insertIndex !== -1) {
      readme = readme.slice(0, insertIndex) + insertBlock + readme.slice(insertIndex);
    } else {
      readme += `\n${insertBlock}\n`;
    }
  }

  fs.writeFileSync(readmePath, readme, "utf-8");
  console.log("Successfully updated README.md with live open-source contributions!");
}

run().catch((err) => {
  console.error("Failed to update contributions:", err);
  process.exit(1);
});
