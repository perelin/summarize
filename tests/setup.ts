process.env.SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP = "1";
// The media proxy is a fallback only. Scrub it so a developer's shell (or CI env) cannot
// silently add a second yt-dlp attempt to every download test. Tests that exercise the
// fallback stub it explicitly.
delete process.env.YT_DLP_PROXY;
