import { Link } from "react-router";
import { BRAND_NAME, BRAND_WORDMARK } from "@/lib/brandName";

// Coming-soon placeholder (Rober 7-06). The interactive /roles map is the only live
// surface of Northgoing for now; every onward flow (sign-in, CV upload, profile,
// apply) routes here until those pages ship. Liquid-glass card over blurred colour
// blobs to match the app; self-contained so it stands alone, theme-aware.
export default function UnderConstruction() {
  return (
    <div className="uc">
      <div className="uc-blob uc-blob-a" aria-hidden="true" />
      <div className="uc-blob uc-blob-b" aria-hidden="true" />
      <div className="uc-card">
        <span className="uc-brand">{BRAND_WORDMARK}</span>
        <div className="uc-emoji" aria-hidden="true">🚧</div>
        <h1>Under construction</h1>
        <p>
          This part of {BRAND_NAME} isn&rsquo;t live yet, but the interactive roles
          map is. Explore product roles across Europe while we build the rest.
        </p>
        <Link className="uc-btn" to="/">Back to the map</Link>
      </div>
      <style>{`
        .uc { position: relative; min-height: 100vh; display: grid; place-items: center; padding: 24px;
          box-sizing: border-box; overflow: hidden; color: #0b1f26;
          font-family: 'Geist Sans', system-ui, -apple-system, sans-serif;
          background: linear-gradient(165deg, #eef4f6 0%, #d9e6ea 100%); }
        .uc-blob { position: absolute; border-radius: 50%; filter: blur(64px); opacity: 0.5; pointer-events: none; }
        .uc-blob-a { width: 520px; height: 520px; top: -130px; left: -90px;
          background: radial-gradient(circle, #1fd8b8, transparent 68%); }
        .uc-blob-b { width: 560px; height: 560px; bottom: -170px; right: -120px;
          background: radial-gradient(circle, #34e3ff, transparent 68%); }
        .uc-card { position: relative; z-index: 1; max-width: 470px; padding: 42px 38px; text-align: center;
          border-radius: 24px; background: rgba(255, 255, 255, 0.52);
          -webkit-backdrop-filter: blur(22px) saturate(160%); backdrop-filter: blur(22px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 30px 80px -34px rgba(20, 60, 70, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.8); }
        .uc-brand { display: inline-block; font-weight: 700; font-size: 14px;
          letter-spacing: -0.02em; color: #33525c; margin-bottom: 22px;
          font-family: 'Space Grotesk', system-ui, sans-serif; }
        .uc-emoji { font-size: 42px; line-height: 1; margin-bottom: 16px; }
        .uc h1 { font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 30px; font-weight: 700;
          letter-spacing: -0.02em; margin: 0 0 14px; color: #0b1f26; }
        .uc p { font-size: 15px; line-height: 1.6; color: #405b64; margin: 0 0 30px; }
        .uc-btn { display: inline-flex; align-items: center; justify-content: center; padding: 12px 24px;
          border-radius: 13px; background: linear-gradient(135deg, #1fd8b8, #34e3ff); color: #05221c;
          font-weight: 700; font-size: 14px; text-decoration: none;
          box-shadow: 0 14px 34px -14px rgba(31, 216, 184, 0.85); transition: transform 0.15s ease, filter 0.15s ease; }
        .uc-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
        @media (prefers-color-scheme: dark) {
          .uc { color: #eaf2f3; background: linear-gradient(165deg, #0c2230 0%, #06121a 100%); }
          .uc-card { background: rgba(22, 38, 46, 0.5); border-color: rgba(255, 255, 255, 0.14);
            box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.12); }
          .uc-brand { color: #9db1b8; }
          .uc h1 { color: #eaf2f3; }
          .uc p { color: #b3c4cb; }
        }
      `}</style>
    </div>
  );
}
