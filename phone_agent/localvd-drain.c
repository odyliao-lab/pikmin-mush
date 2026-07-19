#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2 || argv[1][0] == '\0') {
        fprintf(stderr, "usage: %s ABSTRACT_SOCKET_NAME\n", argv[0]);
        return 2;
    }

    const char *name = argv[1][0] == '@' ? argv[1] + 1 : argv[1];
    size_t name_length = strlen(name);
    if (name_length + 1 > sizeof(((struct sockaddr_un *) 0)->sun_path)) {
        fprintf(stderr, "socket name is too long\n");
        return 2;
    }

    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        perror("socket");
        return 1;
    }

    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path + 1, name, name_length);
    socklen_t address_length = (socklen_t) (offsetof(struct sockaddr_un, sun_path)
            + 1 + name_length);

    if (connect(fd, (struct sockaddr *) &address, address_length) != 0) {
        perror("connect");
        close(fd);
        return 1;
    }

    char buffer[16384];
    for (;;) {
        ssize_t count = read(fd, buffer, sizeof(buffer));
        if (count == 0) {
            break;
        }
        if (count < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("read");
            close(fd);
            return 1;
        }
    }

    close(fd);
    return 0;
}
