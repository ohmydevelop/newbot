import hashlib


def directory_hash(directory):
    digest = hashlib.sha256()
    files = sorted(
        (file for file in directory.rglob("*") if file.is_file()),
        key=lambda file: file.relative_to(directory).as_posix(),
    )
    for file in files:
        digest.update(file.relative_to(directory).as_posix().encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()
