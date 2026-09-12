import { sb } from "../supabaseClient.js";
import { store, on, profileById } from "../state.js";
import { el, esc, toast, avatarHTML, timeAgo } from "../utils.js";
import { confirmModal } from "../ui.js";

// A team-only social feed, wins, shout-outs, quick updates, announcements.
// Different from the Activity Feed (auto-generated system log of "created a
// contract"-type events, read-only) and from Messages (a template library,
// not a conversation). Permission model is deliberately the OPPOSITE of
// Niches/Services/Portfolio: everyone posts and comments; only the owner
// can pin or delete a post (moderation stays in one place, same reasoning
// as Contracts/Invoices/Projects); a comment's own author can delete their
// own comment immediately, same as any chat app. See migration_community.sql
// for the full RLS reasoning.
//
// Post images live in the private "community-media" bucket (org-scoped
// folder + createSignedUrl on read), same pattern as grid-media, NOT
// portfolio-media's public bucket, since this content is internal team
// chatter with no reason to ever be publicly reachable.

const expandedComments = new Set(); // post ids currently showing their comment thread
const signedUrlCache = new Map(); // storage path -> { url, at }

function isActive() {
  return document.getElementById("view-community")?.classList.contains("active");
}

function isOwnerNow() {
  return store.profile?.role === "owner";
}

function visiblePosts() {
  return store.communityPosts
    .slice()
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || new Date(b.created_at) - new Date(a.created_at));
}

function commentsFor(postId) {
  return store.communityComments
    .filter((c) => c.post_id === postId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function reactionsFor(postId) {
  return store.communityReactions.filter((r) => r.post_id === postId);
}

async function signedImageUrl(path) {
  if (!path) return null;
  const cached = signedUrlCache.get(path);
  if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.url;
  const { data, error } = await sb.storage.from("community-media").createSignedUrl(path, 3600);
  if (error || !data) return null;
  signedUrlCache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

function heartIcon(filled) {
  return filled
    ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.3C.5 8 2 4.5 5.5 3.7 8 3.1 10 4.3 12 6.7c2-2.4 4-3.6 6.5-3 3.5.8 5 4.3 3.5 8-2.5 4.7-10 9.3-10 9.3z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7.5-4.6-10-9.3C.5 8 2 4.5 5.5 3.7 8 3.1 10 4.3 12 6.7c2-2.4 4-3.6 6.5-3 3.5.8 5 4.3 3.5 8-2.5 4.7-10 9.3-10 9.3z"/></svg>`;
}

const commentIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

export function renderCommunity() {
  const root = document.getElementById("view-community");
  root.innerHTML = "";
  const wrap = el(`
    <div>
      <div class="page-title mt-0">Community Feed<span class="accent">.</span></div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">
        Wins, updates, and shout-outs for the whole team, anyone can post, comment, and like. ${isOwnerNow() ? "As owner, you can also pin a post to the top or delete one outright." : ""}
      </p>
      <div class="card" id="cf-composer-card" style="margin-bottom:18px;"></div>
      <div id="cf-feed"></div>
    </div>
  `);
  root.appendChild(wrap);
  renderComposer(wrap.querySelector("#cf-composer-card"));
  renderFeed(wrap.querySelector("#cf-feed"));
}

function renderComposer(cardEl) {
  if (!cardEl) return;
  cardEl.innerHTML = "";
  const box = el(`
    <div>
      <textarea id="cf-body" placeholder="Share a win, an update, an announcement..." style="min-height:60px;"></textarea>
      <div id="cf-image-slot" style="display:none;width:100%;max-height:220px;border-radius:8px;overflow:hidden;margin-top:10px;background:rgba(255,255,255,0.06);"></div>
      <input id="cf-file-input" type="file" accept="image/*" style="display:none;" />
      <div class="flex-between" style="margin-top:10px;">
        <span class="small-link" id="cf-add-image">+ Add Image</span>
        <button id="cf-post-btn" class="btn btn-primary" style="width:auto;padding:8px 20px;">Post</button>
      </div>
    </div>
  `);
  cardEl.appendChild(box);

  let pendingImagePath = null;
  const fileInput = box.querySelector("#cf-file-input");
  const imageSlot = box.querySelector("#cf-image-slot");
  box.querySelector("#cf-add-image").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image file", "error");
    if (file.size > 5 * 1024 * 1024) return toast("Image must be under 5MB", "error");

    const localPreview = URL.createObjectURL(file);
    imageSlot.style.display = "block";
    imageSlot.innerHTML = `<img src="${localPreview}" alt="" style="width:100%;max-height:220px;object-fit:cover;display:block;" />`;

    const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || "");
    const ext = (extMatch ? extMatch[1] : "jpg").toLowerCase();
    const path = `${store.profile.org_id}/${Date.now()}.${ext}`;

    // See gridPlans.js's upload handler for why: raw File/Blob bodies can
    // trigger a streamed fetch() that throws a bare "Failed to fetch" in
    // some Chrome builds. Reading into an ArrayBuffer first avoids that.
    const fileBuffer = await file.arrayBuffer();
    const { error: upErr } = await sb.storage.from("community-media").upload(path, fileBuffer, { cacheControl: "3600", contentType: file.type });
    if (upErr) {
      toast(upErr.message || "Upload failed", "error");
      imageSlot.style.display = "none";
      imageSlot.innerHTML = "";
      pendingImagePath = null;
      return;
    }
    pendingImagePath = path;
    toast("Image attached", "success");
  });

  box.querySelector("#cf-post-btn").addEventListener("click", async () => {
    const body = box.querySelector("#cf-body").value.trim();
    if (!body && !pendingImagePath) return toast("Write something or attach an image first", "error");

    const btn = box.querySelector("#cf-post-btn");
    btn.disabled = true;
    const { error } = await sb.from("community_posts").insert({
      body,
      image_path: pendingImagePath,
      created_by: store.profile.id,
    });
    btn.disabled = false;
    if (error) return toast(error.message, "error");
    toast("Posted", "success");
    box.querySelector("#cf-body").value = "";
    imageSlot.style.display = "none";
    imageSlot.innerHTML = "";
    pendingImagePath = null;
  });
}

function renderFeed(feedEl) {
  if (!feedEl) feedEl = document.getElementById("cf-feed");
  if (!feedEl) return;

  const posts = visiblePosts();
  feedEl.innerHTML = "";
  if (!posts.length) {
    feedEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <p>No posts yet. Be the first to share something with the team.</p>
      </div>
    `));
    return;
  }

  posts.forEach((post) => feedEl.appendChild(postCard(post)));
}

function postCard(post) {
  const author = profileById(post.created_by);
  const authorName = author?.full_name || author?.email || "Former teammate";
  const myId = store.profile?.id;
  const liked = reactionsFor(post.id).some((r) => r.user_id === myId);
  const likeCount = reactionsFor(post.id).length;
  const comments = commentsFor(post.id);
  const expanded = expandedComments.has(post.id);

  const card = el(`
    <div class="card" style="margin-bottom:14px;">
      <div class="flex-between" style="align-items:flex-start;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          ${avatarHTML(authorName, author?.avatar_url, 32, 12)}
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(authorName)}</div>
            <div class="text-faint" style="font-size:11px;">${timeAgo(post.created_at)}${post.pinned ? " · 📌 Pinned" : ""}</div>
          </div>
        </div>
        ${isOwnerNow() ? `
          <div style="display:flex;gap:10px;flex:0 0 auto;">
            <span class="small-link" id="cf-pin-${post.id}">${post.pinned ? "Unpin" : "Pin"}</span>
            <span class="small-link" id="cf-delete-${post.id}" style="color:var(--danger);">Delete</span>
          </div>
        ` : ""}
      </div>
      ${post.body ? `<div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;margin-bottom:${post.image_path ? "10px" : "8px"};">${esc(post.body)}</div>` : ""}
      ${post.image_path ? `<div id="cf-img-${post.id}" style="width:100%;min-height:80px;max-height:320px;border-radius:8px;overflow:hidden;margin-bottom:10px;background:rgba(255,255,255,0.06);"></div>` : ""}
      <div style="display:flex;gap:18px;align-items:center;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
        <span class="small-link" id="cf-like-${post.id}" style="display:flex;align-items:center;gap:5px;${liked ? "color:var(--gold);" : ""}">${heartIcon(liked)}${likeCount ? likeCount : ""}</span>
        <span class="small-link" id="cf-comment-toggle-${post.id}" style="display:flex;align-items:center;gap:5px;">${commentIcon}${comments.length ? comments.length : ""}</span>
      </div>
      ${expanded ? `<div id="cf-comments-${post.id}" style="margin-top:12px;"></div>` : ""}
    </div>
  `);

  card.querySelector(`#cf-like-${post.id}`).addEventListener("click", async () => {
    const mine = reactionsFor(post.id).find((r) => r.user_id === myId);
    if (mine) {
      const { error } = await sb.from("community_reactions").delete().eq("id", mine.id);
      if (error) toast(error.message, "error");
    } else {
      const { error } = await sb.from("community_reactions").insert({ post_id: post.id, user_id: myId });
      if (error) toast(error.message, "error");
    }
  });

  card.querySelector(`#cf-comment-toggle-${post.id}`).addEventListener("click", () => {
    if (expandedComments.has(post.id)) expandedComments.delete(post.id);
    else expandedComments.add(post.id);
    renderFeed();
  });

  if (isOwnerNow()) {
    card.querySelector(`#cf-pin-${post.id}`).addEventListener("click", async () => {
      const { error } = await sb.from("community_posts").update({ pinned: !post.pinned }).eq("id", post.id);
      if (error) toast(error.message, "error");
    });
    card.querySelector(`#cf-delete-${post.id}`).addEventListener("click", () => {
      confirmModal({
        title: "Delete this post?",
        body: "This removes the post and all its comments and likes. This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("community_posts").delete().eq("id", post.id);
          if (error) return toast(error.message, "error");
          toast("Post deleted", "success");
        },
      });
    });
  }

  if (post.image_path) {
    const imgSlot = card.querySelector(`#cf-img-${post.id}`);
    signedImageUrl(post.image_path).then((url) => {
      if (url && imgSlot) imgSlot.innerHTML = `<img src="${url}" alt="" style="width:100%;max-height:320px;object-fit:cover;display:block;" />`;
    });
  }

  if (expanded) {
    const commentsBox = card.querySelector(`#cf-comments-${post.id}`);
    if (commentsBox) renderComments(commentsBox, post, comments);
  }

  return card;
}

function renderComments(container, post, comments) {
  container.innerHTML = "";
  const myId = store.profile?.id;

  const list = el(`<div></div>`);
  comments.forEach((c) => {
    const cAuthor = profileById(c.created_by);
    const cAuthorName = cAuthor?.full_name || cAuthor?.email || "Former teammate";
    const canDelete = isOwnerNow() || c.created_by === myId;
    list.appendChild(el(`
      <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;">
        ${avatarHTML(cAuthorName, cAuthor?.avatar_url, 24, 10)}
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;"><b>${esc(cAuthorName)}</b> <span class="text-faint" style="font-size:10.5px;">${timeAgo(c.created_at)}</span></div>
          <div style="font-size:12.5px;line-height:1.4;white-space:pre-wrap;">${esc(c.body)}</div>
        </div>
        ${canDelete ? `<span class="small-link" data-del-comment="${c.id}" style="font-size:10.5px;flex:0 0 auto;">Delete</span>` : ""}
      </div>
    `));
  });
  container.appendChild(list);

  list.querySelectorAll("[data-del-comment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await sb.from("community_comments").delete().eq("id", btn.dataset.delComment);
      if (error) toast(error.message, "error");
    });
  });

  const composer = el(`
    <div style="display:flex;gap:8px;margin-top:6px;">
      <input type="text" placeholder="Write a comment..." style="flex:1;" data-comment-input />
      <button class="btn btn-ghost" style="width:auto;padding:6px 14px;" data-comment-send>Send</button>
    </div>
  `);
  container.appendChild(composer);

  const input = composer.querySelector("[data-comment-input]");
  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    const { error } = await sb.from("community_comments").insert({ post_id: post.id, body, created_by: store.profile.id });
    input.disabled = false;
    if (error) return toast(error.message, "error");
    input.value = "";
    input.focus();
  };
  composer.querySelector("[data-comment-send]").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

export function initCommunityView() {
  on("communityPosts", () => { if (isActive()) renderFeed(); });
  on("communityComments", () => { if (isActive()) renderFeed(); });
  on("communityReactions", () => { if (isActive()) renderFeed(); });
}
