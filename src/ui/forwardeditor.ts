// Port-forward row types — shared by the forward table (ui/forwardtable.ts),
// the SSH host form (settings/sshhosteditor.ts), and the quick panel
// (terminal/quickpanel.ts). The interactive endpoint editor was removed
// with the standalone forwarding dialog (design: forwards are edited in
// the command-palette overlay).

export type ForwardKind = "local" | "remote" | "dynamic";

export interface ForwardEditorValue {
  kind: ForwardKind;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}
