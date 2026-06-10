// Minimal MPRIS player for integration testing. Run with: gjs -m tests/mock-player.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ROOT_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="Identity" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="CanQuit" type="b" access="read"/>
  </interface>
</node>`;

const PLAYER_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek"><arg type="x" direction="in" name="Offset"/></method>
    <method name="SetPosition">
      <arg type="o" direction="in" name="TrackId"/>
      <arg type="x" direction="in" name="Position"/>
    </method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus"     type="s" access="readwrite"/>
    <property name="Shuffle"        type="b" access="readwrite"/>
    <property name="Metadata"       type="a{sv}" access="read"/>
    <property name="Volume"         type="d" access="readwrite"/>
    <property name="Position"       type="x" access="read"/>
    <property name="CanGoNext"      type="b" access="read"/>
    <property name="CanGoPrevious"  type="b" access="read"/>
    <property name="CanPlay"        type="b" access="read"/>
    <property name="CanPause"       type="b" access="read"/>
    <property name="CanSeek"        type="b" access="read"/>
  </interface>
</node>`;

const root = {
    Raise() {}, Quit() {},
    Identity: 'Mock Player',
    CanRaise: false,
    CanQuit: true,
};

const player = {
    PlayPause() { print('mock: PlayPause'); },
    Next() { print('mock: Next'); },
    Previous() { print('mock: Previous'); },
    Seek(_o) {},
    SetPosition(_t, p) { print(`mock: SetPosition ${p}`); },
    PlaybackStatus: 'Playing',
    LoopStatus: 'None',
    Shuffle: false,
    Metadata: {
        'xesam:title':  GLib.Variant.new_string('Integration Test Song With A Long Marquee Title'),
        'xesam:artist': new GLib.Variant('as', ['Mock Artist']),
        'xesam:album':  GLib.Variant.new_string('Mock Album'),
        'mpris:length': GLib.Variant.new_int64(180_000_000),
        'mpris:trackid': new GLib.Variant('o', '/mock/track/1'),
    },
    Volume: 0.7,
    Position: 42_000_000,
    CanGoNext: true,
    CanGoPrevious: true,
    CanPlay: true,
    CanPause: true,
    CanSeek: true,
};

const loop = new GLib.MainLoop(null, false);

Gio.bus_own_name(
    Gio.BusType.SESSION,
    'org.mpris.MediaPlayer2.mocktest',
    Gio.BusNameOwnerFlags.NONE,
    (conn) => {
        const rootImpl = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, root);
        rootImpl.export(conn, '/org/mpris/MediaPlayer2');
        const playerImpl = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);
        playerImpl.export(conn, '/org/mpris/MediaPlayer2');
        print('mock player up');
    },
    null,
    () => { print('mock: lost name'); loop.quit(); }
);

loop.run();
