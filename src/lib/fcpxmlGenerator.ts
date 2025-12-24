/**
 * FCPXML Generator for DaVinci Resolve / Final Cut Pro / Premiere Pro
 * Generates FCPXML 1.8 format for timeline import
 */

export interface FCPXMLImage {
  index: number;
  startSeconds: number;
  endSeconds: number;
}

export interface FCPXMLCaption {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface FCPXMLData {
  projectTitle: string;
  audioDuration: number;
  images: FCPXMLImage[];
  captions: FCPXMLCaption[];
}

/**
 * Convert seconds to FCPXML rational time format
 * Uses 30fps base: 100/3000s = 1/30 second
 */
function secondsToRational(seconds: number): string {
  // For whole seconds, just use simple format
  if (Number.isInteger(seconds)) {
    return `${seconds}s`;
  }
  // For fractional seconds, use 30fps rational format
  const frames = Math.round(seconds * 30);
  const numerator = frames * 100;
  // Simplify common cases
  if (numerator % 3000 === 0) {
    return `${numerator / 3000}s`;
  }
  return `${numerator}/3000s`;
}

/**
 * Escape special XML characters
 */
function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate FCPXML 1.8 document
 */
export function generateFCPXML(data: FCPXMLData): string {
  const { projectTitle, audioDuration, images, captions } = data;

  // Calculate total duration from audio or last image
  const totalDuration = audioDuration > 0
    ? audioDuration
    : (images.length > 0 ? images[images.length - 1].endSeconds : 0);

  // Generate image asset definitions
  const imageAssets = images.map((img, i) => {
    const filename = `image_${String(i + 1).padStart(3, '0')}.png`;
    return `        <asset id="img${i + 1}" name="${filename}" hasVideo="1" hasAudio="0" format="r1">
            <media-rep kind="original-media" src="file://./media/${filename}"/>
        </asset>`;
  }).join('\n');

  // Generate image clips on the spine (video track)
  const imageClips = images.map((img, i) => {
    const duration = img.endSeconds - img.startSeconds;
    const offset = img.startSeconds;
    return `            <asset-clip ref="img${i + 1}" offset="${secondsToRational(offset)}" name="image_${String(i + 1).padStart(3, '0')}" duration="${secondsToRational(duration)}" start="0s" tcFormat="NDF"/>`;
  }).join('\n');

  // Generate caption titles (on lane 1, above video)
  const captionTitles = captions.map((cap, i) => {
    const duration = cap.endSeconds - cap.startSeconds;
    const offset = cap.startSeconds;
    const escapedText = escapeXML(cap.text);
    return `            <title ref="titleEffect" lane="1" offset="${secondsToRational(offset)}" duration="${secondsToRational(duration)}" name="Caption ${i + 1}">
                <text>
                    <text-style ref="ts1">${escapedText}</text-style>
                </text>
            </title>`;
  }).join('\n');

  // Build the complete FCPXML document
  const fcpxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
    <resources>
        <!-- Video format: 1080p30 -->
        <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>

        <!-- Audio asset -->
        <asset id="audioAsset" name="voiceover" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000" duration="${secondsToRational(audioDuration)}">
            <media-rep kind="original-media" src="file://./media/voiceover.wav"/>
        </asset>

        <!-- Image assets -->
${imageAssets}

        <!-- Title effect for captions -->
        <effect id="titleEffect" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>

        <!-- Text style for captions -->
        <text-style-def id="ts1">
            <text-style font="Helvetica" fontSize="48" fontFace="Regular" fontColor="1 1 1 1" backgroundColor="0 0 0 0.5" bold="0"/>
        </text-style-def>
    </resources>

    <library location="file://./HistoryGenAI.fcpbundle/">
        <event name="HistoryGenAI Export">
            <project name="${escapeXML(projectTitle)}" uid="${generateUID()}">
                <sequence format="r1" duration="${secondsToRational(totalDuration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
                    <spine>
                        <!-- Video track: Images with timing -->
${imageClips}

                        <!-- Audio track (lane -1, below video) -->
                        <asset-clip ref="audioAsset" lane="-1" offset="0s" name="voiceover" duration="${secondsToRational(audioDuration)}" start="0s" tcFormat="NDF" audioRole="dialogue"/>

                        <!-- Caption titles (lane 1, above video) -->
${captionTitles}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;

  return fcpxml;
}

/**
 * Generate a unique ID for the project
 */
function generateUID(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let uid = '';
  for (let i = 0; i < 8; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid + '-' + Date.now().toString(36).toUpperCase();
}

/**
 * Parse SRT content into caption objects
 */
export function parseSRTToCaptions(srtContent: string): FCPXMLCaption[] {
  const captions: FCPXMLCaption[] = [];
  const blocks = srtContent.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    // Parse timestamp line: "00:00:00,000 --> 00:00:02,500"
    const timestampMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timestampMatch) continue;

    const startSeconds =
      parseInt(timestampMatch[1]) * 3600 +
      parseInt(timestampMatch[2]) * 60 +
      parseInt(timestampMatch[3]) +
      parseInt(timestampMatch[4]) / 1000;

    const endSeconds =
      parseInt(timestampMatch[5]) * 3600 +
      parseInt(timestampMatch[6]) * 60 +
      parseInt(timestampMatch[7]) +
      parseInt(timestampMatch[8]) / 1000;

    // Join remaining lines as caption text
    const text = lines.slice(2).join(' ').trim();

    if (text) {
      captions.push({ startSeconds, endSeconds, text });
    }
  }

  return captions;
}
