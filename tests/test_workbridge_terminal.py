import json
import os
import pty
import select
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CLI=ROOT/'workbridge/scripts/dist/cli.js'
NODE=shutil.which('node')

class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wb-terminal-')
        self.root=Path(self.temp.name).resolve()
        self.bin=self.root/'bin'; self.bin.mkdir()
        for name,body in {
            'npx': f"#!{NODE}\nimport('{ROOT / 'tests/fixtures/fake_discourse.mjs'}');\n",
            'uv': f"#!{NODE}\nconsole.log('fixture-python');\n",
            'codex': f"#!{NODE}\nimport('{ROOT / 'tests/fixtures/workbridge_host.mjs'}');\n",
            'uvx': f"#!{NODE}\nif(process.argv.includes('--version')){{console.log('fixture');}}else{{import('{ROOT / 'tests/fixtures/fake_mcp_server.mjs'}');}}\n",
        }.items():
            p=self.bin/name;p.write_text(body);p.chmod(0o700)
        self.env={**os.environ,'WORKBRIDGE_HOME':str(self.root/'state'),'WB_FAKE_HOST':str(self.root/'host.json'),'PATH':str(self.bin)+os.pathsep+os.environ['PATH']}
    def tearDown(self):self.temp.cleanup()
    def run_tty(self,answer,extra=None,provider="tapd",site_args=None):
        master,slave=pty.openpty()
        proc=subprocess.Popen([NODE,str(CLI),'connect',provider,'--host','codex','--connection','work','--yes',*(extra or []),*(site_args or [])],stdin=slave,stdout=slave,stderr=slave,env=self.env,start_new_session=True)
        os.close(slave); output=b'';sent=False;deadline=time.monotonic()+15
        try:
            while time.monotonic()<deadline:
                if select.select([master],[],[],0.05)[0]:
                    try:chunk=os.read(master,65536)
                    except OSError:break
                    output+=chunk
                    if not sent and '隐藏输入'.encode() in output:
                        # Wait until Inquirer has enabled raw/no-echo mode.
                        time.sleep(0.1);os.write(master,answer);sent=True
                if proc.poll() is not None:break
            proc.wait(timeout=5)
            return proc.returncode,output.decode(errors='replace')
        finally:
            if proc.poll() is None:proc.kill();proc.wait()
            os.close(master)
    def test_hidden_token_connect_and_idempotent_reconnect(self):
        secret='fake-terminal-token-9842'
        code,out=self.run_tty((secret+'\r').encode())
        self.assertEqual(code,0,out);self.assertNotIn(secret,out)
        host=(self.root/'host.json').read_text();self.assertNotIn(secret,host)
        state=json.loads((self.root/'state/connections/work.json').read_text())
        self.assertEqual(state['state'],'pending-host-reload')
        credential=Path(state['credentialRef']);self.assertEqual(credential.stat().st_mode&0o777,0o600)
        self.assertEqual(json.loads(credential.read_text())['token'],secret)
        proc=subprocess.run([NODE,str(CLI),'connect','tapd','--host','codex','--connection','work'],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(proc.returncode,0,proc.stdout);self.assertTrue(json.loads(proc.stdout)['reused'])
    def test_failed_reauthorization_preserves_original_credentials(self):
        code,out=self.run_tty(b'first-fixture-token\r');self.assertEqual(code,0,out)
        state_path=self.root/'state/connections/work.json';original=state_path.read_text()
        self.env['FAKE_MCP_FAIL']='1'
        code,out=self.run_tty(b'bad-second-token\r',['--replace'])
        self.assertNotEqual(code,0);self.assertEqual(state_path.read_text(),original);self.assertNotIn('bad-second-token',out)
    def test_pending_registration_recovers_exact_owned_host(self):
        code,out=self.run_tty(b'first-fixture-token\r');self.assertEqual(code,0,out)
        path=self.root/'state/connections/work.json';state=json.loads(path.read_text());del state['hostFingerprint'];path.write_text(json.dumps(state))
        p=subprocess.run([NODE,str(CLI),'connect','tapd','--host','codex','--connection','work','--yes'],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,0,p.stdout);self.assertIn('hostFingerprint',json.loads(path.read_text()))
    def test_remote_switch_readback_failure_restores_local_then_roundtrip(self):
        code,out=self.run_tty(b'first-fixture-token\r');self.assertEqual(code,0,out)
        state_path=self.root/'state/connections/work.json';before=json.loads(state_path.read_text())
        self.env['WB_FAIL_READBACK']=str(self.root/'failed-once')
        cmd=[NODE,str(CLI),'connection','configure','work','--transport','streamable-http','--url','https://example.com/mcp','--auth','oauth','--yes']
        p=subprocess.run(cmd,env=self.env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(p.returncode,0);self.assertEqual(json.loads(state_path.read_text())['transport'],'stdio')
        self.assertEqual(json.loads((self.root/'host.json').read_text())['workbridge-work']['transport']['type'],'stdio')
        p=subprocess.run(cmd,env=self.env,capture_output=True,text=True,timeout=10);self.assertEqual(p.returncode,0,p.stdout)
        self.assertEqual(json.loads(state_path.read_text())['transport'],'streamable-http')
        p=subprocess.run([NODE,str(CLI),'connection','configure','work','--transport','stdio','--yes'],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,0,p.stdout);self.assertEqual(json.loads(state_path.read_text())['credentialRef'],before['credentialRef'])
    @unittest.skipUnless(int(subprocess.check_output([NODE,'-p','process.versions.node.split(".")[0]'],text=True))>=24,'Discourse requires Node 24')
    def test_discourse_browser_then_reuse_and_reauthorize_with_writes(self):
        self.env['NODE_OPTIONS']='--import='+str(ROOT/'tests/fixtures/fake_about.mjs')
        code,out=self.run_tty(b'',provider='discourse',site_args=['--site','https://forum.example.com'])
        self.assertEqual(code,0,out);self.assertNotIn('fixture-discourse-key',out)
        path=self.root/'state/connections/work.json';state=json.loads(path.read_text());self.assertFalse(state['allowWrites'])
        external=self.root/'external-profile.json';external.write_text(json.dumps({'auth_pairs':[{'site':'https://forum.example.com','user_api_key':'external-fixture'}]}));external.chmod(0o600)
        code,out=self.run_tty(b'',extra=['--replace','--allow-writes','--profile',str(external)],provider='discourse')
        self.assertEqual(code,0,out);self.assertTrue(json.loads(path.read_text())['allowWrites']);self.assertTrue(external.exists())
        result=subprocess.run([NODE,str(CLI),'disconnect','work','--yes'],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stdout);self.assertTrue(external.exists())
    @unittest.skipUnless(int(subprocess.check_output([NODE,'-p','process.versions.node.split(".")[0]'],text=True))>=24,'Discourse requires Node 24')
    def test_discourse_cancelled_browser_leaves_no_registration(self):
        self.env['NODE_OPTIONS']='--import='+str(ROOT/'tests/fixtures/fake_about.mjs');self.env['WB_CANCEL_BROWSER']='1'
        code,out=self.run_tty(b'',provider='discourse',site_args=['--site','https://forum.example.com'])
        self.assertNotEqual(code,0);self.assertFalse((self.root/'host.json').exists());self.assertEqual(list((self.root/'state/credentials').glob('*.json')),[])
    def test_cancel_does_not_configure_or_save_credential(self):
        code,out=self.run_tty(b'\x03')
        self.assertNotEqual(code,0);self.assertFalse((self.root/'host.json').exists())
        self.assertEqual(list((self.root/'state/credentials').glob('*.json')),[])
    def test_invalid_token_does_not_configure_or_leak(self):
        self.env['FAKE_MCP_FAIL']='1';secret='invalid-terminal-fixture'
        code,out=self.run_tty((secret+'\r').encode())
        self.assertNotEqual(code,0);self.assertNotIn(secret,out);self.assertFalse((self.root/'host.json').exists())
        self.assertEqual(list((self.root/'state/credentials').glob('*.json')),[])
    def test_non_tty_requires_interactive_terminal(self):
        p=subprocess.run([NODE,str(CLI),'connect','tapd','--host','codex','--connection','work','--yes'],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(p.returncode,0);self.assertIn('INTERACTIVE_REQUIRED',p.stdout)
        self.assertFalse((self.root/'host.json').exists())

if __name__=='__main__':unittest.main()
