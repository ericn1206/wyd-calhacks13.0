import { Icon } from '../ui/Icon'

export function DesktopPreview({ onReturn }: { onReturn: () => void }) {
  return <div className="mock-desktop"><div className="mock-menu-bar"><div><strong>●</strong><span>Finder</span><span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Window</span><span>Help</span></div><div><Icon name="window" /><Icon name="camera" /><span>Tue 10:42 AM</span></div></div><div className="wallpaper-shape shape-one" /><div className="wallpaper-shape shape-two" /><div className="wallpaper-shape shape-three" /><div className="mock-native-dock">{['#73a9e8', '#68c795', '#f1c568', '#ec8e82', '#9e91dc', '#6bc4cb', '#d4d9dc'].map((color, index) => <span key={color} style={{ background: color }}><i>{index === 0 ? 'W' : ''}</i></span>)}</div><button className="return-from-desktop" onClick={onReturn}><Icon name="arrow" />Return to WYD!!</button></div>
}
