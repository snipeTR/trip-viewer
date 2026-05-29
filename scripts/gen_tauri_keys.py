"""
Generate a Tauri v2-compatible minisign signing keypair.

Outputs:
  tauri_signing_key.pub  - public key (content goes into tauri.conf.json pubkey field)
  tauri_signing_key.key  - private key (content goes into TAURI_SIGNING_PRIVATE_KEY secret)

Usage:
  python scripts/gen_tauri_keys.py

Both output files are created in the current working directory (repo root).
The script also prints the exact values to paste into GitHub Secrets.
"""

import os
import sys
import struct
import base64
import hashlib
import getpass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption,
)

# Minisign constants
SIG_ALG  = b"Ed"  # Ed25519
KDF_ALG  = b"Sc"  # scrypt
CHK_ALG  = b"B2"  # BLAKE2b

# scrypt parameters matching minisign defaults
OPSLIMIT = 33_554_432    # 2^25
MEMLIMIT = 1_073_741_824 # 2^30
SCRYPT_N = 1_048_576     # 2^20  (= MEMLIMIT / (128 * r))
SCRYPT_R = 8
SCRYPT_P = 1
DK_LEN   = 104           # bytes to derive; equals the encrypted payload size


def generate(password: str):
    # Ed25519 keypair
    priv = Ed25519PrivateKey.generate()
    pub  = priv.public_key()

    seed    = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())  # 32 B
    pub_raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)                     # 32 B

    # libsodium-style secret key: seed || public_key
    sk = seed + pub_raw  # 64 B

    # Random key identifiers
    key_id   = os.urandom(8)   # 8 B key number
    kdf_salt = os.urandom(32)  # 32 B scrypt salt

    # Checksum: BLAKE2b-256( sig_alg || key_id || pub_raw )
    checksum = hashlib.blake2b(
        SIG_ALG + key_id + pub_raw,
        digest_size=32,
    ).digest()  # 32 B

    # Plaintext to encrypt: key_id(8) || sk(64) || checksum(32) = 104 B
    plaintext = key_id + sk + checksum

    # Key derivation
    keystream = hashlib.scrypt(
        password.encode("utf-8"),
        salt=kdf_salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
        dklen=DK_LEN,
    )

    encrypted = bytes(a ^ b for a, b in zip(plaintext, keystream))  # 104 B

    # --- Secret key binary blob (166 bytes) ---
    # sig_alg(2) kdf_alg(2) chk_alg(2) key_id(8) salt(32)
    # opslimit(8 LE) memlimit(8 LE) encrypted(104)
    sk_blob = (
        SIG_ALG + KDF_ALG + CHK_ALG
        + key_id
        + kdf_salt
        + struct.pack("<Q", OPSLIMIT)
        + struct.pack("<Q", MEMLIMIT)
        + encrypted
    )
    assert len(sk_blob) == 166, f"unexpected sk_blob length {len(sk_blob)}"

    # --- Public key binary blob (42 bytes) ---
    # sig_alg(2) key_id(8) pub_raw(32)
    pk_blob = SIG_ALG + key_id + pub_raw
    assert len(pk_blob) == 42, f"unexpected pk_blob length {len(pk_blob)}"

    key_id_hex = key_id.hex().upper()

    # Minisign text-format files (what `minisign -G` would produce)
    pub_file_text = (
        f"untrusted comment: minisign public key: {key_id_hex}\n"
        + base64.b64encode(pk_blob).decode()
        + "\n"
    )
    sk_file_text = (
        f"untrusted comment: minisign secret key: {key_id_hex}\n"
        + base64.b64encode(sk_blob).decode()
        + "\n"
    )

    # Tauri reads TAURI_SIGNING_PRIVATE_KEY as the raw .key file content
    # (or its base64 encoding — we output the raw content which is what
    # `tauri signer generate` outputs to stdout/the file)
    tauri_private_key = sk_file_text

    # tauri.conf.json pubkey = base64(entire .pub file text)
    tauri_pubkey_conf = base64.b64encode(pub_file_text.encode()).decode()

    return tauri_pubkey_conf, tauri_private_key, pub_file_text, sk_file_text


def main():
    print("=== Tauri v2 Signing Keypair Generator ===")
    print()
    print("Choose a strong password to protect the private key.")
    print("You will also set it as TAURI_SIGNING_PRIVATE_KEY_PASSWORD.")
    print()

    pw1 = getpass.getpass("Password: ")
    if not pw1:
        print("ERROR: password must not be empty.", file=sys.stderr)
        sys.exit(1)
    pw2 = getpass.getpass("Confirm : ")
    if pw1 != pw2:
        print("ERROR: passwords do not match.", file=sys.stderr)
        sys.exit(1)

    print("\nGenerating keypair (this may take a few seconds)...")
    tauri_pubkey_conf, tauri_priv_key, pub_text, sk_text = generate(pw1)

    pub_path = "tauri_signing_key.pub"
    key_path = "tauri_signing_key.key"

    with open(pub_path, "w", newline="\n") as f:
        f.write(pub_text)
    with open(key_path, "w", newline="\n") as f:
        f.write(sk_text)

    sep = "=" * 70
    print(f"\n{sep}")
    print(f"Files written: {pub_path}  {key_path}")
    print(sep)

    print("""
STEP 1 — GitHub Secret: TAURI_SIGNING_PRIVATE_KEY
  Go to: Settings → Secrets and variables → Actions → New repository secret
  Name : TAURI_SIGNING_PRIVATE_KEY
  Value: (paste the ENTIRE content of tauri_signing_key.key, including the
          'untrusted comment' line and the base64 line)
""")
    print(f"--- tauri_signing_key.key content ---")
    print(sk_text.strip())
    print("--- end ---")

    print(f"""
STEP 2 — GitHub Secret: TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  Name : TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  Value: <the password you just typed>

STEP 3 — tauri.conf.json pubkey
  Replace the current 'pubkey' value in src-tauri/tauri.conf.json with:
""")
    print(f"--- pubkey value ---")
    print(tauri_pubkey_conf)
    print("--- end ---")

    print(f"""
{sep}
KEEP tauri_signing_key.key SAFE and SECRET.
Losing it means existing installs can no longer auto-update.
Do NOT commit tauri_signing_key.key to git.
{sep}
""")


if __name__ == "__main__":
    main()
