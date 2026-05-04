export const config = { runtime: "edge" };

export default async function handler(req) {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { mentorEmail, learnerName, skill } = await req.json();

    if (!mentorEmail || !skill) {
      return new Response(JSON.stringify({ error: "mentorEmail and skill are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Step 1: Get Zoom OAuth token ───────────────────────────────────────
    const accountId    = process.env.ZOOM_ACCOUNT_ID;
    const clientId     = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Zoom env vars not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          Authorization:  `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: "Zoom token failed", detail: err.reason || tokenRes.statusText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const { access_token } = await tokenRes.json();

    // ── Step 2: Create Zoom meeting ────────────────────────────────────────
    const meetRes = await fetch(
      `https://api.zoom.us/v2/users/${mentorEmail}/meetings`,
      {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic:      `TT Session: ${skill}`,
          type:       2,                        // scheduled
          start_time: new Date(Date.now() + 5 * 60_000).toISOString(),
          duration:   60,
          timezone:   "Asia/Kolkata",
          agenda:     `1-on-1 session: ${skill} — learner: ${learnerName || "learner"}`,
          settings: {
            host_video:        true,
            participant_video:  true,
            join_before_host:  false,
            waiting_room:      true,
            mute_upon_entry:   false,
            auto_recording:    "none",
          },
        }),
      }
    );

    if (!meetRes.ok) {
      const err = await meetRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: "Zoom meeting creation failed", detail: err.message }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const meeting = await meetRes.json();

    // ── Step 3: Return clean response ─────────────────────────────────────
    return new Response(
      JSON.stringify({
        meetingId: String(meeting.id),
        joinUrl:   meeting.join_url,
        startUrl:  meeting.start_url,
        password:  meeting.password || "",
      }),
      {
        status: 200,
        headers: {
          "Content-Type":                "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: err.message }),
      {
        status: 500,
        headers: {
          "Content-Type":                "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}