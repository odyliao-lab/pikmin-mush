#include "../cpp/scanner-performance.h"
#include <cassert>
#include <string>
#include <utility>
#include <initializer_list>
int main() {
    assert(scanner_render_fps(nullptr)==0);
    for (auto [input,expected] : {std::pair<std::string,int>{"20\n",20},
         {"15\r\n",15},{"30",30},{"20 ",20},{"60",0},{"-1",0},
         {"",0},{"020",0},{"20oops",0},{"20\n30",0},{std::string("20\0junk",7),0},
         {std::string(100,'2'),0}}) {
        FILE *f=tmpfile(); assert(f); fwrite(input.data(),1,input.size(),f); rewind(f);
        assert(scanner_render_fps(f)==expected); fclose(f);
    }
}
