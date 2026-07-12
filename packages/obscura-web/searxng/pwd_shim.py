# Windows shim for the POSIX-only `pwd` module.
#
# SearXNG's searx/valkeydb.py does a top-level `import pwd` (to resolve a unix-socket owner when
# valkey is configured that way). SearXNG is not officially Windows-native; `pwd` doesn't exist there.
# We don't run valkey over a unix socket, so the functions below are never actually called — this stub
# only needs to make the import succeed. Drop it on the venv's import path
# (`<venv>/Lib/site-packages/pwd.py`) before running the app on Windows.
import collections

struct_passwd = collections.namedtuple(
    "struct_passwd",
    "pw_name pw_passwd pw_uid pw_gid pw_gecos pw_dir pw_shell",
)


def getpwnam(name):
    return struct_passwd(name, "x", 0, 0, "", "", "")


def getpwuid(uid):
    return struct_passwd("root", "x", int(uid), 0, "", "", "")


def getpwall():
    return []
