import appIconUrl from '../assets/icons/voiceideas-app.svg'
import recorderActiveIconUrl from '../assets/icons/voiceideas-recorder-active.svg'
import recorderIdleIconUrl from '../assets/icons/voiceideas-recorder-idle.svg'

interface VoiceIdeasIconProps {
  className?: string
  alt?: string
}

interface VoiceIdeasRecorderIconProps extends VoiceIdeasIconProps {
  active?: boolean
}

function getA11yProps(alt?: string) {
  if (alt && alt.trim()) {
    return { alt }
  }

  return { alt: '', 'aria-hidden': true as const }
}

export function VoiceIdeasAppIcon({ className = '', alt }: VoiceIdeasIconProps) {
  return (
    <img
      src={appIconUrl}
      className={className}
      draggable={false}
      {...getA11yProps(alt)}
    />
  )
}

export function VoiceIdeasRecorderIcon({
  className = '',
  alt,
  active = false,
}: VoiceIdeasRecorderIconProps) {
  return (
    <img
      src={active ? recorderActiveIconUrl : recorderIdleIconUrl}
      className={className}
      draggable={false}
      {...getA11yProps(alt)}
    />
  )
}
